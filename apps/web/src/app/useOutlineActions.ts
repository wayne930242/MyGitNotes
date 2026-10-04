import { useLayoutEffect, useRef, useState } from 'react';
import { isOutlinePath } from '@mygitnotes/core/outline';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { readNote } from '../lib/api.js';
import type { NoteItem } from '../lib/types.js';
import type { WorkspaceState } from './workspace-state.js';
import type { NewNoteOptions } from './useNewNoteDialog.js';
import type { OutlineActions, OutlineInsertionRequest } from '../lib/outline-actions.js';
import { useTranslation } from '../lib/i18n/index.js';

interface Params {
  config: WorkspaceState['config'];
  repositoryFor: WorkspaceState['repositoryFor'];
  readDraft: WorkspaceState['readDraft'];
  remote: boolean;
  sourceId: string;
  selectedNotebookId: string;
  locationKey: string;
  routedRef: NoteRef | null;
  prepareLeave: () => Promise<boolean>;
  openNote: (note: NoteItem) => Promise<unknown>;
  openNewNote: (options: NewNoteOptions) => void;
  onError: (message: string) => void;
}

interface SourceRequest {
  source: NoteItem;
  repository: string;
  root: string;
  locationKey: string;
  sourceId: string;
  selectedNotebookId: string;
  id: number;
}
interface Pending extends OutlineInsertionRequest {
  origin: SourceRequest;
  armed: boolean;
}

/** Coordinates navigation only. The mounted editor, never this hook, edits the destination body. */
export function useOutlineActions(params: Params) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<SourceRequest | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(params);
  const serial = useRef(0);
  const queued = useRef<Pending | null>(null);
  const running = useRef(false);
  useLayoutEffect(() => () => {
    serial.current++;
    queued.current = null;
  }, []);
  useLayoutEffect(() => {
    latest.current = params;
  });
  const validOwner = (request: SourceRequest) => {
    const live = latest.current;
    const owner = live.config?.notebooks.find(nb => nb.id === request.source.notebookId);
    const repository = live.repositoryFor(request.source.notebookId);
    return repository?.id === request.repository && Boolean(repository.write) && owner?.root === request.root;
  };
  const validOrigin = (request: SourceRequest) => validOwner(request) && request.id === serial.current && latest.current.locationKey === request.locationKey && latest.current.sourceId === request.sourceId && latest.current.selectedNotebookId === request.selectedNotebookId;
  const cancel = () => {
    serial.current++;
    queued.current = null;
    setPending(null);
    setDialog(null);
    setError('');
  };
  useLayoutEffect(() => {
    const target = pending && params.routedRef && noteRefKey(pending.destination) === noteRefKey(params.routedRef);
    if ((dialog && !validOrigin(dialog)) || (pending && (!validOwner(pending.origin) || (!target && params.locationKey !== pending.origin.locationKey)))) {
      // A route/repository change permanently cancels, even if the user later returns to the same path.
      /* eslint-disable react/set-state-in-effect -- Invalidate a deferred user action when its owning navigation scope changes. */
      cancel();
      /* eslint-enable react/set-state-in-effect */
    }
  });
  const add = (source: NoteItem) => {
    cancel();
    const live = latest.current;
    const owner = live.config?.notebooks.find(nb => nb.id === source.notebookId);
    const repository = live.repositoryFor(source.notebookId);
    if (!owner || !repository?.write) {
      live.onError(t('outline.readOnly'));
      return;
    }
    setDialog({ source, repository: repository.id, root: owner.root, locationKey: live.locationKey, sourceId: live.sourceId, selectedNotebookId: live.selectedNotebookId, id: serial.current });
  };
  const choose = async (destination: NoteRef | null) => {
    if (!dialog || running.current || !validOrigin(dialog)) return;
    const request = dialog;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (destination && (destination.notebookId !== request.source.notebookId || !isOutlinePath(destination.path))) throw new Error(t('outline.changed'));
      if (!await latest.current.prepareLeave()) throw new Error(t('outline.saveFailed'));
      if (!validOrigin(request)) return;
      if (!destination) {
        setDialog(null);
        latest.current.openNewNote({ kind: 'outline', notebookId: request.source.notebookId, initialLink: request.source });
        return;
      }
      const draft = latest.current.remote ? latest.current.readDraft(destination.notebookId, destination.path) : undefined;
      const note = draft?.note ?? await readNote(destination.path, destination.notebookId);
      if (!validOrigin(request)) return;
      if (noteRefKey(note) !== noteRefKey(destination) || !isOutlinePath(note.path)) throw new Error(t('outline.changed'));
      const insertion: Pending = { id: request.id, destination, source: request.source, origin: request, armed: false };
      queued.current = insertion;
      setPending(insertion);
      setDialog(null);
      if (await latest.current.openNote(note) === false) throw new Error(t('outline.saveFailed'));
      if (serial.current !== request.id || !validOwner(request)) return;
      const armed = { ...insertion, armed: true };
      queued.current = armed;
      setPending(armed);
    } catch (caught) {
      if (validOrigin(request)) {
        queued.current = null;
        setPending(null);
        setError((caught as Error).message);
        setDialog(request);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const value: OutlineActions = {
    add,
    canAdd: notebookId => Boolean(params.repositoryFor(notebookId)?.write),
    pending: pending?.armed && params.routedRef && noteRefKey(pending.destination) === noteRefKey(params.routedRef) ? pending : null,
    cancel,
    error: params.onError,
    consume: id => {
      const request = queued.current;
      if (!request?.armed || request.id !== id || serial.current !== id || !validOwner(request.origin) || !latest.current.routedRef || noteRefKey(latest.current.routedRef) !== noteRefKey(request.destination)) return false;
      queued.current = null;
      setPending(null);
      return true;
    },
  };
  return { value, dialog, busy, error, choose, cancel };
}
