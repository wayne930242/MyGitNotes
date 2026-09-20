import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useScreenPage } from './use-screen-page.js';
import { useFocusPage } from './use-focus-page.js';
import { AssetItem, FolderItem, GitStatus, NoteItem, WorkspaceConfig } from './types.js';
import { fetchAssets, fetchFolders, fetchGitStatus, fetchWorkspace } from './api.js';
import { clearCommittedNotes, readWorkingNotes, updateWorkingNote, WorkingNotes } from './working-notes.js';
import { sameValue } from './merge-note.js';
import { invalidateNoteQueries } from './use-note-queries.js';
import { setWorkspaceNotebooks } from './workspace-links.js';

export interface UseWorkspaceSyncOptions {
  routeNotebook?: string;
  onStageNote?: (note: NoteItem) => void;
}

export function useWorkspaceSync(options: UseWorkspaceSyncOptions) {
  const { routeNotebook, onStageNote } = options;
  const queryClient = useQueryClient();

  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [remote, setRemote] = useState(false);
  const loadedWorkspace = useRef('');
  const refreshRequest = useRef(0);
  const [canWrite, setCanWrite] = useState(false);
  const [revision, setRevision] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');

  const [repoRoot, setRepoRoot] = useState<string>('');
  const [branch, setBranch] = useState<string>('core');
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  useEffect(() => {
    setWorkspaceNotebooks(config?.notebooks || []);
  }, [config]);
  const [serverGitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [workingNotes, setWorkingNotes] = useState<WorkingNotes>({});

  const selectedNotebookId = routeNotebook || config?.workspace.default_notebook || config?.notebooks[0]?.id || 'example';

  const workingScope = `${sourceId}:${branch}`;

  const screen = useScreenPage(
    remote ? sourceId : `local:${repoRoot}`,
    () => {
      void fetchGitStatus().then((result) => setGitStatus(result.status));
    },
    remote,
    Boolean(config && sourceId),
    config,
  );

  const focus = useFocusPage(
    remote ? sourceId : `local:${repoRoot}`,
    () => {
      void fetchGitStatus().then((result) => setGitStatus(result.status));
    },
    remote,
    Boolean(config && sourceId),
    config,
  );

  const documents = [screen, focus];
  // Remote drafts wait in Changes until committed; local ones autosave to the working tree.
  const pendingDocuments = remote && canWrite ? documents.filter((document) => document.dirty) : [];
  const activeWorkingNotes = useMemo(() => (remote && canWrite ? workingNotes : {}), [remote, canWrite, workingNotes]);

  /* eslint-disable react/use-memo -- The joined pending-document paths intentionally form a stable primitive projection key. */
  /* eslint-disable react-hooks/exhaustive-deps -- Pending file paths are the status projection key; newly allocated document controllers with the same paths must retain the memoized status identity. */
  const gitStatus = useMemo<GitStatus | null>(() => {
    if (remote) {
      return { branch, isClean: !pendingDocuments.length && Object.keys(activeWorkingNotes).length === 0, staged: [], modified: [...Object.values(activeWorkingNotes).filter((entry) => entry.base).map((entry) => entry.note.path), ...pendingDocuments.map((document) => document.file)], untracked: Object.values(activeWorkingNotes).filter((entry) => !entry.base).map((entry) => entry.note.path) };
    }
    return serverGitStatus;
  }, [remote, branch, workingNotes, canWrite, serverGitStatus, pendingDocuments.map((document) => document.file).join('\n'), activeWorkingNotes]);
  /* eslint-enable react-hooks/exhaustive-deps */
  /* eslint-enable react/use-memo */

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === `gh_notes_working:${workingScope}`) {
        try {
          setWorkingNotes(readWorkingNotes(workingScope));
        } catch (error) {
          setActionError((error as Error).message);
        }
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [workingScope]);

  // The workspace answer is applied before folders arrive, so the note queries keyed by source
  // and revision start in parallel with `/api/folders` instead of waiting behind it.
  const refreshWorkspace = useCallback(async () => {
    const request = ++refreshRequest.current;
    try {
      const ws = await fetchWorkspace();
      if (request !== refreshRequest.current) return;
      const folderRequest = fetchFolders();
      const workspace = JSON.stringify([ws.source.identity, ws.branch, ws.config?.notebooks.map((nb) => [nb.id, nb.root])]);
      // A local workspace keeps one empty revision, so its cached answers are refetched by hand.
      if (ws.capabilities.local && loadedWorkspace.current) void invalidateNoteQueries(queryClient);
      loadedWorkspace.current = workspace;
      setSourceId(ws.source.identity);
      setRemote(!ws.capabilities.local);
      setCanWrite(ws.capabilities.write);
      setRevision(ws.revision || '');
      setLoadError('');
      setRepoRoot(ws.repoRoot);
      setBranch(ws.branch);
      setConfig((previous) => (sameValue(previous, ws.config) ? previous : ws.config));
      setWorkingNotes(ws.capabilities.local ? {} : readWorkingNotes(`${ws.source.identity}:${ws.branch}`));
      setGitStatus(ws.gitStatus);

      const folderList = await folderRequest;
      if (request !== refreshRequest.current) return;
      setFolders((previous) => (sameValue(previous, folderList) ? previous : folderList));
    } catch (err) {
      if (request !== refreshRequest.current) return;
      loadedWorkspace.current = '';
      setFolders([]);
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

  const stageWorkingNote = (note: NoteItem, base: NoteItem | null, blocked?: string) => {
    note = { ...note, status: typeof note.metadata.status === 'string' ? note.metadata.status : undefined, tags: Array.isArray(note.metadata.tags) ? note.metadata.tags.map(String) : [], title: typeof note.metadata.title === 'string' && note.metadata.title ? note.metadata.title : note.content.match(/^#\s+(.+)$/m)?.[1] || note.title };
    const previous = readWorkingNotes(workingScope)[note.path];
    const entry = { note, base, ...(blocked ? { blocked } : {}) };
    if (!sameValue(previous, entry)) {
      setWorkingNotes(updateWorkingNote(workingScope, note.path, entry));
    }
    onStageNote?.(note);
    return note;
  };

  const discardWorkingNote = (path: string) => {
    setWorkingNotes(updateWorkingNote(workingScope, path, null));
  };

  const clearCommittedWorkingNotes = (sent: WorkingNotes) => {
    setWorkingNotes(clearCommittedNotes(workingScope, sent));
  };

  return { selectedNotebookId, folders, setFolders, sourceId, remote, canWrite, revision, setRevision, loadError, loading, setLoading, actionError, setActionError, repoRoot, branch, config, setConfig, serverGitStatus, gitStatus, setGitStatus, assets, setAssets, workingNotes, setWorkingNotes, workingScope, activeWorkingNotes, screen, focus, documents, pendingDocuments, refreshWorkspace, stageWorkingNote, discardWorkingNote, clearCommittedWorkingNotes };
}
