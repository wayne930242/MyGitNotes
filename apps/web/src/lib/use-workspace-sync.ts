import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { announceWorkspaceFilesChanged } from './workspace-changes.js';
import { useQueryClient } from '@tanstack/react-query';
import type { RepositoryId } from '@mygitnotes/core/repository';
import { useFocusPage } from './use-focus-page.js';
import { legacyBookmarkRecoveries } from './legacy-bookmark-recovery.js';
import { useTranslation } from './i18n/index.js';
import { pendingDocumentDrafts } from './use-workspace-document.js';
import { WORKSPACE_DOCUMENT_CLIENTS } from './workspace-document-clients.js';
import { AssetItem, FolderItem, GitStatus, NoteItem, WorkspaceConfig } from './types.js';
import { fetchAssets, fetchFolders, fetchGitStatus, fetchWorkspace, openWorkspaceEvents } from './api.js';
import { clearCommittedNotes, readStoredWorkingNotes, readWorkingNotes, updateWorkingNote, type WorkingNote, type WorkingNotes } from './working-notes.js';
import { isNotebookKey, resolveBareId } from './notebook-keys.js';
import { sameValue } from './merge-note.js';
import { invalidateNoteQueries, NOTE_QUERY_KEY } from './use-note-queries.js';
import { setWorkspaceNotebooks } from './workspace-links.js';
import { setNotebookPreferences } from './notebook-preferences.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { listLocalDrafts } from './storage.js';
import { draftScope, draftStore, notebookRepositories, repositoryOf, type WorkspaceRepository } from './workspace-repositories.js';
import { noteRefKey } from '@mygitnotes/core/note-query';

export interface UseWorkspaceSyncOptions {
  routeNotebook?: string;
  onStageNote?: (note: NoteItem) => void;
}

/** Whether a workspace `change` event says the members changed, rather than files in a worktree. */
function membershipEvent(event: Event): boolean {
  try {
    return (JSON.parse(String((event as MessageEvent).data)) as { membership?: unknown; } | null)?.membership === true;
  } catch {
    return false;
  }
}

export function useWorkspaceSync(options: UseWorkspaceSyncOptions) {
  const { routeNotebook, onStageNote } = options;
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [folders, setFolders] = useState<FolderItem[]>([]);
  // True until the first folder list arrives; until then an empty `folders` means unknown, not none.
  const [foldersLoading, setFoldersLoading] = useState(true);
  // The workspace is identified by its default repository.
  const [sourceId, setSourceId] = useState('');
  const [remote, setRemote] = useState(false);
  const loadedWorkspace = useRef('');
  const refreshRequest = useRef(0);
  const [repositories, setRepositories] = useState<WorkspaceRepository[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');

  const [repoRoot, setRepoRoot] = useState<string>('');
  /** The deployment lets each visitor choose their repository. */
  const [repositoryChoice, setRepositoryChoice] = useState(false);
  /** Settings offers Core updates: for a local Core checkout, or a remote deployment's product repository. */
  const [coreUpdate, setCoreUpdate] = useState(false);
  /** The workspace configuration as routes and the app name it: every notebook by its key. */
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  useEffect(() => {
    setWorkspaceNotebooks(config?.notebooks || []);
  }, [config]);
  const [serverGitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  /** Staged remote drafts, by repository. */
  const [workingNotes, setWorkingNotes] = useState<Record<RepositoryId, WorkingNotes>>({});

  /** The key an old bare local id stands for in the loaded workspace, as the bare-id redirect resolves it. */
  const resolveBareNotebook = (localId: string) => resolveBareId(notebookRepositories(repositories), sourceId, localId);
  // A route that still names a bare local id selects the notebook it resolves to while the redirect replaces the URL.
  const routedNotebook = routeNotebook && !isNotebookKey(routeNotebook) ? resolveBareNotebook(routeNotebook) ?? routeNotebook : routeNotebook;
  const selectedNotebookId = routedNotebook || config?.workspace.default_notebook || config?.notebooks[0]?.id || 'example';

  const defaultRepository = repositories.find(repository => repository.id === sourceId);
  const defaultRepositoryBranch = defaultRepository?.branch ?? '';
  const repositoryFor = (notebookId: string) => repositoryOf(repositories, notebookId);
  // Each note takes the preferences of its own repository; without a notebook, the default repository's, and with
  // none, the built-in ones. Children read them while they render — a `useState` initializer runs before any
  // effect — so setting them in an effect would hand the first mount the previous preferences.
  setNotebookPreferences(notebookId => (notebookId ? repositoryFor(notebookId)?.preferences : undefined) ?? defaultRepository?.preferences ?? DEFAULT_WORKSPACE_PREFERENCES);
  const canWriteNotebook = (notebookId: string) => Boolean(repositoryFor(notebookId)?.write);
  const revisionFor = (notebookId: string) => repositoryFor(notebookId)?.revision ?? '';
  const setRepositoryRevision = (id: RepositoryId, revision: string) => setRepositories(previous => previous.map(repository => repository.id === id ? { ...repository, revision } : repository));
  /** Keeps the revision a manifest save answered, since a refetch may still answer from the snapshot before it. */
  const setManifestRevision = (id: RepositoryId, configRevision: string) => setRepositories(previous => previous.map(repository => repository.id === id ? { ...repository, configRevision } : repository));
  const setNotebookRevision = (notebookId: string, revision: string) => {
    const repository = repositoryFor(notebookId);
    if (repository) setRepositoryRevision(repository.id, revision);
  };
  const available = repositories.filter(repository => !repository.unavailable);

  /** The draft store of the repository serving a notebook. */
  const draftStoreFor = (notebookId: string) => {
    const repository = repositoryFor(notebookId);
    if (!repository) throw new Error(`Notebook ${notebookId} is not served by any repository.`);
    return { repository, store: draftStore(repository) };
  };
  const readDraft = (notebookId: string, path: string): WorkingNote | undefined => readWorkingNotes(draftStoreFor(notebookId).store)[path];
  /** The draft at a path of one repository, as the Changes dialog names it. */
  const readDraftIn = (repositoryId: RepositoryId, path: string): WorkingNote | undefined => {
    const repository = available.find(candidate => candidate.id === repositoryId);
    return repository ? readWorkingNotes(draftStore(repository))[path] : undefined;
  };
  const updateDraft = (notebookId: string, path: string, entry: WorkingNote | null) => {
    const { repository, store } = draftStoreFor(notebookId);
    const entries = updateWorkingNote(store, path, entry);
    setWorkingNotes(previous => ({ ...previous, [repository.id]: entries }));
  };
  /** Clears the drafts a commit to `repository` sent, keeping any edit made meanwhile. */
  const clearCommittedDrafts = (repository: WorkspaceRepository, sent: WorkingNotes) => {
    const entries = clearCommittedNotes(draftStore(repository), sent);
    setWorkingNotes(previous => ({ ...previous, [repository.id]: entries }));
  };
  /** Whether any repository holds staged drafts or unsaved editor drafts. */
  const hasPendingDrafts = () => {
    if (legacyBookmarkRecoveries(repositories.map(repository => repository.id)).length > 0) throw new Error(t('legacyOutline.blocker'));
    return available.some(repository => Object.keys(readStoredWorkingNotes(draftScope(repository))).length || listLocalDrafts(draftScope(repository)).length) || pendingDocumentDrafts(WORKSPACE_DOCUMENT_CLIENTS, available.filter(repository => repository.write)).length > 0;
  };

  // Workspace documents live in each notebook repository; the open notebook's repository serves Screen and Focus.
  const documentRepository = repositoryFor(selectedNotebookId);
  const documentOwner = documentRepository && !documentRepository.unavailable ? { id: documentRepository.id, alias: documentRepository.alias } : undefined;
  const refreshGitStatus = () => {
    void fetchGitStatus().then((result) => setGitStatus(result.status));
  };
  const focus = useFocusPage(documentOwner, refreshGitStatus, remote, Boolean(config && sourceId));

  const documents = [focus];
  // Remote drafts wait in Changes until committed, whichever notebook is open; local ones autosave to the working tree.
  const pendingDocuments = remote ? pendingDocumentDrafts(WORKSPACE_DOCUMENT_CLIENTS, repositories.filter(repository => repository.write)) : [];
  const writable = repositories.filter(repository => repository.write).map(repository => repository.id).join('\n');
  /** Drafts of the repositories this requester may commit to, by `noteRefKey`: two repositories can hold the same path. */
  const activeWorkingNotes = useMemo<WorkingNotes>(() => (remote ? Object.fromEntries(writable.split('\n').filter(Boolean).flatMap(id => Object.values(workingNotes[id] ?? {})).map(entry => [noteRefKey(entry.note), entry])) : {}), [remote, writable, workingNotes]);

  /* eslint-disable react/use-memo -- The joined pending-document repositories and paths intentionally form a stable primitive projection key. */
  /* eslint-disable react-hooks/exhaustive-deps -- Pending file paths are the status projection key; newly allocated document controllers with the same paths must retain the memoized status identity. */
  const gitStatus = useMemo<GitStatus | null>(() => {
    if (remote) {
      return { branch: defaultRepositoryBranch, isClean: !pendingDocuments.length && Object.keys(activeWorkingNotes).length === 0, staged: [], modified: [...Object.values(activeWorkingNotes).filter((entry) => entry.base).map((entry) => entry.note.path), ...pendingDocuments.map((document) => document.file)], untracked: Object.values(activeWorkingNotes).filter((entry) => !entry.base).map((entry) => entry.note.path) };
    }
    return serverGitStatus;
  }, [remote, defaultRepositoryBranch, serverGitStatus, pendingDocuments.map((document) => `${document.repository}\t${document.file}`).join('\n'), activeWorkingNotes]);
  /* eslint-enable react-hooks/exhaustive-deps */
  /* eslint-enable react/use-memo */

  const scopes = available.map(repository => `${repository.id}\t${draftScope(repository)}\t${repository.alias}`).join('\n');
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      for (const line of scopes.split('\n').filter(Boolean)) {
        const [id, scope, alias] = line.split('\t');
        if (event.key !== `gh_notes_working:${scope}`) continue;
        try {
          setWorkingNotes(previous => ({ ...previous, [id]: readWorkingNotes({ scope, alias }) }));
        } catch (error) {
          setActionError((error as Error).message);
        }
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [scopes]);

  // The workspace answer is applied, and the page shown, before folders arrive, so the note queries
  // keyed by source and revision start in parallel with `/api/folders` instead of waiting behind it;
  // the folder tree fills in when its answer lands.
  // `fresh` reads each branch head past the server's cache, which may still hold a head from
  // before a commit when another server instance answers.
  const refreshWorkspace = useCallback(async (fresh?: boolean) => {
    const request = ++refreshRequest.current;
    try {
      const ws = await fetchWorkspace(fresh === true);
      if (request !== refreshRequest.current) return;
      const folderRequest = fetchFolders();
      const workspace = JSON.stringify([ws.defaultRepository, ws.repositories.map((repository) => [repository.id, repository.branch]), ws.keyedConfig?.notebooks.map((nb) => [nb.id, nb.root])]);
      // A local workspace has no revisions, so its cached answers are refetched by hand.
      if (ws.local && loadedWorkspace.current) void invalidateNoteQueries(queryClient);
      loadedWorkspace.current = workspace;
      setSourceId(ws.defaultRepository ?? '');
      setRemote(!ws.local);
      setRepositories((previous) => (sameValue(previous, ws.repositories) ? previous : ws.repositories));
      setLoadError('');
      setRepoRoot(ws.repoRoot ?? '');
      setRepositoryChoice(ws.repositoryChoice === true);
      setCoreUpdate(ws.coreUpdate === true);
      setConfig((previous) => (sameValue(previous, ws.keyedConfig) ? previous : ws.keyedConfig));
      setWorkingNotes(ws.local ? {} : Object.fromEntries(ws.repositories.filter((repository) => !repository.unavailable).map((repository) => [repository.id, readWorkingNotes(draftStore(repository))])));
      setGitStatus(ws.repositories.find((repository) => repository.id === ws.defaultRepository)?.gitStatus ?? null);
      setLoading(false);

      const folderList = await folderRequest;
      if (request !== refreshRequest.current) return;
      setFolders((previous) => (sameValue(previous, folderList) ? previous : folderList));
      setFoldersLoading(false);
    } catch (err) {
      if (request !== refreshRequest.current) return;
      loadedWorkspace.current = '';
      setFolders([]);
      setFoldersLoading(false);
      setAssets([]);
      setConfig(null);
      setLoadError(err instanceof Error ? err.message : 'Failed to load workspace');
    } finally {
      if (request === refreshRequest.current) setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void refreshWorkspace();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the latest request, including refreshes started after mounting; this ref is a sequence counter, not a DOM node.
      refreshRequest.current++;
    };
  }, [refreshWorkspace]);

  /** After a membership change, here or in another tab: the workspace again, and no cached result of a repository that left or was hidden. */
  const membershipChanged = useCallback(async () => {
    await refreshWorkspace(true);
    await queryClient.resetQueries({ queryKey: NOTE_QUERY_KEY });
  }, [refreshWorkspace, queryClient]);

  // A local workspace hears of files changed outside the app (an editor, an agent, Git) from the
  // server's watcher; it reconnects when its repositories change, so a newly mapped worktree is watched.
  // A membership change made in any tab arrives here too, so every tab drops a repository that was hidden or removed.
  const watchedRepositories = remote || !sourceId ? '' : repositories.map(repository => repository.id).join('\n');
  useEffect(() => {
    if (!watchedRepositories) return;
    const events = openWorkspaceEvents();
    events.addEventListener('change', event => {
      announceWorkspaceFilesChanged();
      void (membershipEvent(event) ? membershipChanged() : refreshWorkspace());
    });
    return () => events.close();
  }, [watchedRepositories, refreshWorkspace, membershipChanged]);

  useEffect(() => {
    if (!sourceId || !config) return;
    let active = true;
    fetchAssets(selectedNotebookId).then((items) => {
      if (active) setAssets(items);
    }).catch(console.error);
    return () => {
      active = false;
    };
  }, [sourceId, selectedNotebookId, config]);

  /** Stages `note` against `base`; with `deleted`, stages the deletion of `base`. */
  const stageWorkingNote = (note: NoteItem, base: NoteItem | null, blocked?: string, deleted?: boolean) => {
    note = { ...note, status: typeof note.metadata.status === 'string' ? note.metadata.status : undefined, tags: Array.isArray(note.metadata.tags) ? note.metadata.tags.map(String) : [], title: typeof note.metadata.title === 'string' && note.metadata.title ? note.metadata.title : note.content.match(/^#\s+(.+)$/m)?.[1] || note.title };
    const previous = readDraft(note.notebookId, note.path);
    const entry: WorkingNote = { note, base, ...(blocked ? { blocked } : {}), ...(deleted && base ? { deleted: true as const } : {}) };
    if (!sameValue(previous, entry)) updateDraft(note.notebookId, note.path, entry);
    onStageNote?.(note);
    return note;
  };

  return { selectedNotebookId, resolveBareNotebook, folders, foldersLoading, setFolders, sourceId, remote, repositories, defaultRepository, defaultRepositoryBranch, repositoryFor, canWriteNotebook, revisionFor, setRepositoryRevision, setNotebookRevision, setManifestRevision, loadError, loading, setLoading, actionError, setActionError, repoRoot, repositoryChoice, coreUpdate, config, setConfig, serverGitStatus, gitStatus, setGitStatus, assets, setAssets, workingNotes, activeWorkingNotes, readDraft, readDraftIn, updateDraft, clearCommittedDrafts, hasPendingDrafts, focus, documents, pendingDocuments, refreshWorkspace, membershipChanged, stageWorkingNote };
}
