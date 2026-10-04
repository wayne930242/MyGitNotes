import { useEffect, useRef, useState } from 'react';
import { addBookmark, type Bookmark, BookmarkError, bookmarkRepositoryPath, type BookmarksPage, findEquivalentBookmark, notebookBookmarks, updateBookmark } from '@mygitnotes/core/bookmarks';
import { captureTextAnchor, resolveTextAnchor, type TextAnchor } from '@mygitnotes/core/bookmark-anchor';
import type { SavedBookmarkQuery } from '@mygitnotes/core/bookmark-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { readNote } from '../lib/api.js';
import { bookmarkFolderRoute, bookmarkQueryRoute } from '../lib/bookmark-navigation.js';
import { notebookRoute } from '../lib/routes.js';
import { type BookmarksController, resolveBookmarks } from '../lib/use-bookmarks.js';
import type { BookmarkContextValue, BookmarkEditRequest, BookmarkPositionRequest } from '../lib/bookmark-context.js';
import type { WorkspaceState } from './workspace-state.js';
import type { NoteItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

interface Params {
  controller: BookmarksController;
  config: WorkspaceState['config'];
  folders: WorkspaceState['folders'];
  repositoryFor: WorkspaceState['repositoryFor'];
  remote: boolean;
  readDraft: WorkspaceState['readDraft'];
  refreshKey: string;
  selectedNotebookId: string;
  captureView: () => SavedBookmarkQuery;
  sort: SavedBookmarkQuery['sort'];
  view: SavedBookmarkQuery['view'];
  prepareLeave: () => Promise<boolean>;
  flushEditors: (keys?: readonly string[]) => Promise<boolean>;
  commitNoteFile: (path: string, notebookId: string) => Promise<void>;
  openNote: (note: NoteItem) => Promise<unknown>;
  navigate: (route: string) => void;
  onError: (message: string) => void;
}
export function useBookmarkActions(params: Params) {
  const { controller, config, folders, repositoryFor, remote, readDraft, refreshKey, captureView, sort, view, prepareLeave, flushEditors, commitNoteFile, openNote, navigate, onError } = params;
  const { t } = useTranslation();
  const [editing, setEditing] = useState<BookmarkEditRequest | null>(null);
  const [queued, setQueued] = useState<{ owner: string; change: (page: BookmarksPage) => BookmarksPage; } | null>(null);
  const [position, setPosition] = useState<BookmarkPositionRequest | null>(null);
  const activation = useRef(0);
  const current = useRef(params);
  /* eslint-disable react/refs -- Async navigation/save continuations validate the latest repository controller before applying state. */
  current.current = params;
  /* eslint-enable react/refs */
  const ready = (owner: string) => {
    const latest = current.current;
    const repository = latest.repositoryFor(owner);
    return Boolean(repository?.write && repository.id === latest.controller.repository && !latest.controller.loading && latest.controller.writable);
  };
  const selectOwner = async (owner: string) => {
    if (!repositoryFor(owner)?.write) throw new BookmarkError('invalid-scope', t('bookmarks.readOnly'));
    if (owner !== current.current.selectedNotebookId || repositoryFor(owner)?.id !== controller.repository) {
      if (!await prepareLeave()) return false;
      navigate(notebookRoute(owner));
    }
    return true;
  };
  const request = (request: BookmarkEditRequest) => {
    void selectOwner(request.notebookId).then(ok => {
      if (ok) setEditing(request);
    }).catch(caught => onError((caught as Error).message));
  };
  const mutate = (owner: string, change: (page: BookmarksPage) => BookmarksPage) => {
    void selectOwner(owner).then(ok => {
      if (!ok) return;
      if (ready(owner)) current.current.controller.change(change(current.current.controller.page));
      else setQueued({ owner, change });
    }).catch(caught => onError((caught as Error).message));
  };
  useEffect(() => {
    if (!queued || controller.loading || repositoryFor(queued.owner)?.id !== controller.repository) return;
    // eslint-disable-next-line react/set-state-in-effect -- Consume a guarded cross-repository action only after its live controller has loaded.
    setQueued(null);
    if (!controller.writable) {
      onError(controller.error || t('bookmarks.readOnly'));
      return;
    }
    try {
      controller.change(queued.change(controller.page));
    } catch (caught) {
      onError((caught as Error).message);
    }
  }, [queued, controller, repositoryFor, onError, t]);
  const save = async (fields: Pick<Bookmark, 'label' | 'groupId' | 'target'>) => {
    if (!editing || !ready(editing.notebookId)) throw new BookmarkError('invalid-scope', t('bookmarks.readOnly'));
    const owner = config!.notebooks.find(nb => nb.id === editing.notebookId)!;
    const repository = repositoryFor(owner.id)!;
    const original = editing;
    let target = fields.target;
    let savedBody: string | undefined;
    if (target.kind === 'position') {
      const path = bookmarkRepositoryPath(owner, target.path, config!.notebooks);
      if (!await flushEditors([noteRefKey({ notebookId: owner.id, path })])) throw new BookmarkError('invalid-position', t('bookmarks.saveError'));
      // Remote editor Save stages a browser draft; only the selected-note commit establishes saved source.
      if (remote && readDraft(owner.id, path)) await commitNoteFile(path, owner.id);
      const saved = await readNote(path, owner.id);
      savedBody = saved.content;
      const resolved = resolveTextAnchor(saved.content, target.anchor);
      if (resolved.state !== 'resolved') throw new BookmarkError('invalid-position', t('bookmarks.changedSelection'));
      target = { ...target, anchor: captureTextAnchor(saved.content, resolved.range, target.anchor.kind) };
    }
    if (current.current.repositoryFor(owner.id)?.id !== repository.id || !ready(owner.id)) throw new BookmarkError('invalid-scope', t('bookmarks.conflict'));
    const live = current.current.controller;
    const existing = findEquivalentBookmark(notebookBookmarks(live.page, owner.id), target, original.id, savedBody);
    const old = notebookBookmarks(live.page, owner.id).bookmarks.find((b: Bookmark) => b.id === original.id);
    if (existing && (!old || JSON.stringify(old.target) !== JSON.stringify(target))) throw new BookmarkError('duplicate-target', t('bookmarks.duplicate'), existing.id);
    const next = original.id ? updateBookmark(live.page, owner.id, original.id, { ...fields, target }) : addBookmark(live.page, owner.id, { id: crypto.randomUUID(), ...fields, target });
    live.change(next);
    setEditing(null);
  };
  const activate = async (ownerId: string, bookmark: Bookmark, wholeNote = false) => {
    const requestId = ++activation.current;
    const owner = config?.notebooks.find(nb => nb.id === ownerId);
    if (!owner || !repositoryFor(ownerId) || bookmark.target.kind === 'url') return;
    try {
      const target = bookmark.target;
      const [resolution] = await resolveBookmarks(ownerId, [{ id: bookmark.id, target }]);
      if (requestId !== activation.current) return;
      if (resolution.state === 'unavailable') throw new BookmarkError('invalid-target', t('bookmarks.unavailable'));
      if (resolution.state === 'unresolved' && !(wholeNote && target.kind === 'position' && ['missing-position', 'ambiguous-position'].includes(resolution.reason))) throw new BookmarkError('invalid-target', t('bookmarks.unresolved'));
      if (!await prepareLeave() || requestId !== activation.current) return;
      setPosition(null);
      if (target.kind === 'query') navigate(bookmarkQueryRoute(owner, target.query));
      else if (target.kind === 'folder') navigate(bookmarkFolderRoute(owner, target.path, sort, view));
      else {
        const path = bookmarkRepositoryPath(owner, target.path, config!.notebooks);
        const note = await readNote(path, ownerId);
        if (requestId !== activation.current) return;
        if (target.kind === 'position' && !wholeNote) setPosition({ id: crypto.randomUUID(), notebookId: ownerId, path, anchor: target.anchor });
        await openNote(note);
      }
    } catch (caught) {
      if (requestId === activation.current) onError((caught as Error).message);
    }
  };
  const notebook = editing && config?.notebooks.find(nb => nb.id === editing.notebookId);
  const value: BookmarkContextValue = {
    controller,
    notebooks: config?.notebooks ?? [],
    folders,
    repositoryFor,
    remote,
    refreshKey,
    request,
    mutate,
    activate,
    captureView,
    position,
    bookmarkNote: note => {
      const owner = config?.notebooks.find(nb => nb.id === note.notebookId);
      if (owner) request({ notebookId: owner.id, target: { kind: note.path.endsWith('.compilation.yml') ? 'compilation' : 'note', path: note.path.slice(owner.root.length + 1) }, label: note.title });
    },
    bookmarkPosition: (note, anchor?: TextAnchor) => {
      const owner = config?.notebooks.find(nb => nb.id === note.notebookId);
      if (owner) {
        const path = note.path.slice(owner.root.length + 1);
        request({ notebookId: owner.id, positionPath: path, ...(anchor ? { target: { kind: 'position', path, anchor } } : {}), label: note.title });
      }
    },
    consumePosition: (id, found) => {
      setPosition(pending => pending?.id === id ? null : pending);
      if (!found) onError(t('bookmarks.unresolved'));
    },
  };
  const dialog = editing && notebook && controller.repository === repositoryFor(notebook.id)?.id && !controller.loading ? { request: editing, notebook, collection: notebookBookmarks(controller.page, notebook.id), folders, remote, writable: controller.writable, captureView, onSave: save, onEditExisting: (id: string) => setEditing({ notebookId: notebook.id, id }), onClose: () => setEditing(null) } : null;
  return { value, dialog };
}
