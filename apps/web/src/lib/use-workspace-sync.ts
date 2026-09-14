import { useState, useEffect, useMemo, useRef } from 'react';
import { SCREEN_PAGE_FILE } from '@mygitnotes/core/screen-page';
import { useScreenPage } from './use-screen-page.js';
import {
  WorkspaceConfig,
  FolderItem,
  NoteItem,
  AssetItem,
  GitStatus,
} from './types.js';
import {
  fetchWorkspace,
  fetchFolders,
  fetchNotes,
  fetchAssets,
  fetchGitStatus,
} from './api.js';
import {
  readWorkingNotes,
  updateWorkingNote,
  clearCommittedNotes,
  overlayWorkingNotes,
  WorkingNotes,
} from './working-notes.js';
import { sameValue } from './merge-note.js';
import { mergeNoteSnapshot } from './note-snapshot.js';

export interface UseWorkspaceSyncOptions {
  routeNotebook?: string;
  onStageNote?: (note: NoteItem) => void;
}

export function useWorkspaceSync(options: UseWorkspaceSyncOptions) {
  const { routeNotebook, onStageNote } = options;

  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [remote, setRemote] = useState(false);
  const loadedRemote = useRef(false);
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
  const [serverGitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [sourceNotes, setNotes] = useState<NoteItem[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [workingNotes, setWorkingNotes] = useState<WorkingNotes>({});

  const selectedNotebookId =
    routeNotebook || config?.workspace.default_notebook || config?.notebooks[0]?.id || 'example';

  const workingScope = `${sourceId}:${branch}`;

  const screen = useScreenPage(
    remote ? sourceId : `local:${repoRoot}`,
    () => {
      void fetchGitStatus().then((result) => setGitStatus(result.status));
    },
    remote,
    Boolean(config && sourceId)
  );

  const screenPending = remote && canWrite && screen.dirty;
  const activeWorkingNotes = remote && canWrite ? workingNotes : {};

  const notes = useMemo(
    () => (remote && canWrite ? overlayWorkingNotes(sourceNotes, workingNotes) : sourceNotes),
    [remote, canWrite, sourceNotes, workingNotes]
  );

  const gitStatus = useMemo<GitStatus | null>(() => {
    if (remote) {
      return {
        branch,
        isClean: !screenPending && Object.keys(activeWorkingNotes).length === 0,
        staged: [],
        modified: [
          ...Object.values(activeWorkingNotes).filter((entry) => entry.base).map((entry) => entry.note.path),
          ...(screenPending ? [SCREEN_PAGE_FILE] : []),
        ],
        untracked: Object.values(activeWorkingNotes).filter((entry) => !entry.base).map((entry) => entry.note.path),
      };
    }
    return serverGitStatus;
  }, [remote, branch, workingNotes, canWrite, serverGitStatus, screenPending, activeWorkingNotes]);

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

  const refreshWorkspace = async (notebookId?: string) => {
    const request = ++refreshRequest.current;
    try {
      const ws = await fetchWorkspace();
      if (request !== refreshRequest.current) return;
      const workspace = JSON.stringify([
        ws.source.identity,
        ws.branch,
        ws.config?.notebooks.map((nb) => [nb.id, nb.root]),
      ]);
      const sameWorkspace = loadedWorkspace.current === workspace;
      const scope =
        ws.capabilities.local && sameWorkspace && ws.config?.notebooks.some((nb) => nb.id === notebookId)
          ? notebookId
          : undefined;
      const [folderList, noteList] = await Promise.all([fetchFolders(), fetchNotes(scope)]);
      if (request !== refreshRequest.current) return;
      loadedWorkspace.current = workspace;
      loadedRemote.current = !ws.capabilities.local;
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

      setFolders((previous) => (sameValue(previous, folderList) ? previous : folderList));
      setNotes((previous) => mergeNoteSnapshot(sameWorkspace ? previous : [], noteList, scope));
    } catch (err) {
      if (request !== refreshRequest.current) return;
      loadedWorkspace.current = '';
      loadedRemote.current = false;
      setNotes([]);
      setFolders([]);
      setAssets([]);
      setConfig(null);
      setLoadError(err instanceof Error ? err.message : 'Failed to load workspace');
    } finally {
      if (request === refreshRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!loadedRemote.current) {
      void refreshWorkspace(loadedWorkspace.current ? selectedNotebookId : undefined);
    }
    return () => {
      refreshRequest.current++;
    };
  }, [selectedNotebookId]);

  useEffect(() => {
    if (!sourceId || !config || selectedNotebookId === 'all') return;
    let active = true;
    fetchAssets(selectedNotebookId)
      .then((items) => {
        if (active) setAssets(items);
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [sourceId, selectedNotebookId, config]);

  const stageWorkingNote = (note: NoteItem, base: NoteItem | null, blocked?: string) => {
    note = {
      ...note,
      status: typeof note.metadata.status === 'string' ? note.metadata.status : undefined,
      tags: Array.isArray(note.metadata.tags) ? note.metadata.tags.map(String) : [],
      title:
        typeof note.metadata.title === 'string' && note.metadata.title
          ? note.metadata.title
          : note.content.match(/^#\s+(.+)$/m)?.[1] || note.title,
    };
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

  const clearCommittedWorkingNotes = (sent: WorkingNotes, resultRevision?: string) => {
    setWorkingNotes(clearCommittedNotes(workingScope, sent));
    if (resultRevision) {
      setNotes((previous) =>
        overlayWorkingNotes(
          previous,
          Object.fromEntries(
            Object.entries(sent).map(([path, entry]) => [
              path,
              { ...entry, note: { ...entry.note, revision: resultRevision } },
            ])
          )
        )
      );
    }
  };

  return {
    selectedNotebookId,
    folders,
    setFolders,
    sourceId,
    remote,
    canWrite,
    revision,
    setRevision,
    loadError,
    loading,
    setLoading,
    actionError,
    setActionError,
    repoRoot,
    branch,
    config,
    setConfig,
    serverGitStatus,
    gitStatus,
    setGitStatus,
    sourceNotes,
    setNotes,
    notes,
    assets,
    setAssets,
    workingNotes,
    setWorkingNotes,
    workingScope,
    activeWorkingNotes,
    screen,
    screenPending,
    refreshWorkspace,
    stageWorkingNote,
    discardWorkingNote,
    clearCommittedWorkingNotes,
  };
}
