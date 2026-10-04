import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addBookmarkGroup, type Bookmark, type BookmarksPage, BookmarksPageSchema, moveBookmark, moveBookmarkGroup, notebookBookmarks, removeBookmark, removeBookmarkGroup, renameBookmarkGroup } from '@mygitnotes/core/bookmarks';
import type { BookmarkResolution } from '@mygitnotes/core';
import { type BookmarkContextValue, useBookmarkActionsContext } from '../lib/bookmark-context.js';
import { bookmarksDocumentClient, resolveBookmarks } from '../lib/use-bookmarks.js';
import { documentDraftKey, readDocumentDraft } from '../lib/use-workspace-document.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Button } from './Button.js';
import './bookmarks.css';

export function BookmarksSection({ notebookId }: { notebookId: string; }) {
  const context = useBookmarkActionsContext();
  return context ? <Section key={`${context.repositoryFor(notebookId)?.id}:${notebookId}`} context={context} notebookId={notebookId} /> : null;
}
function Section({ context, notebookId }: { context: BookmarkContextValue; notebookId: string; }) {
  const { t } = useTranslation();
  const repository = context.repositoryFor(notebookId);
  const live = repository?.id === context.controller.repository;
  const key = `mygitnotes:bookmarks-open:${repository?.id}:${notebookId}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== 'false');
  const [, refreshStorage] = useState(0);
  const query = useQuery({
    queryKey: ['bookmarks', repository?.id, repository?.revision, context.refreshKey],
    enabled: !live && Boolean(repository && !repository.unavailable),
    queryFn: async () => {
      const response = await fetch(`/api/bookmarks?repository=${encodeURIComponent(repository!.id)}`);
      if (!response.ok) throw new Error(t('bookmarks.loadError'));
      const record = await response.json();
      return { page: BookmarksPageSchema.parse(record.page), revision: String(record.revision) };
    },
  });
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (repository && event.key === documentDraftKey(bookmarksDocumentClient, repository.id)) refreshStorage(version => version + 1);
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, [repository]);
  let page: BookmarksPage = live ? context.controller.page : query.data?.page ?? { version: 1, notebooks: [] };
  let error = live ? context.controller.error : query.error?.message ?? '';
  let pending = live && context.controller.dirty;
  if (!live && repository) {
    try {
      const draft = readDocumentDraft(bookmarksDocumentClient, repository.id, page);
      if (draft) {
        page = draft.page;
        pending = true;
        if (query.data && JSON.stringify(draft.base) !== JSON.stringify(query.data.page)) error = t('bookmarks.conflict');
      }
    } catch {
      error = t('bookmarks.loadError');
    }
  }
  const collection = notebookBookmarks(page, notebookId);
  const canEdit = Boolean(repository?.write && !repository.unavailable && !error && (live ? context.controller.writable : !query.isPending));
  const loading = live ? context.controller.loading : query.isPending;
  const [resolutions, setResolutions] = useState<Record<string, BookmarkResolution>>({});
  const [retry, setRetry] = useState(0);
  const [drag, setDrag] = useState<{ kind: 'bookmark' | 'group'; id: string; }>();
  const [dialog, setDialog] = useState<{ kind: 'new-group' | 'rename-group' | 'remove-group' | 'remove-bookmark'; id?: string; label: string; }>();
  const generation = JSON.stringify(collection.bookmarks.map((bookmark: Bookmark) => ({ id: bookmark.id, target: bookmark.target })));
  const repositoryId = repository?.id, repositoryRevision = repository?.revision, unavailable = Boolean(repository?.unavailable);
  useEffect(() => {
    if (!open || !repositoryId || unavailable || loading || error) return;
    const controller = new AbortController();
    let targets: { id: string; target: Bookmark['target']; }[];
    try {
      targets = JSON.parse(generation);
    } catch {
      return;
    }
    resolveBookmarks(notebookId, targets, controller.signal).then(values => {
      if (!controller.signal.aborted) setResolutions(Object.fromEntries(targets.map((target, index) => [target.id, values[index]])));
    }).catch(() => {
      if (!controller.signal.aborted) setResolutions(Object.fromEntries(targets.map(target => [target.id, { state: 'unavailable', retryable: true }])));
    });
    return () => controller.abort();
  }, [open, repositoryId, repositoryRevision, unavailable, notebookId, generation, context.refreshKey, retry, loading, error]);
  const apply = (change: (page: BookmarksPage) => BookmarksPage) => context.mutate(notebookId, change);
  const entries = (groupId: string | null) => {
    const siblings = collection.bookmarks.filter((bookmark: Bookmark) => bookmark.groupId === groupId);
    return (
      <div
        className='bookmark-list'
        onDragOver={event => {
          if (canEdit && drag?.kind === 'bookmark') event.preventDefault();
        }}
        onDrop={event => {
          event.preventDefault();
          if (canEdit && drag?.kind === 'bookmark') apply(page => moveBookmark(page, notebookId, drag.id, groupId));
          setDrag(undefined);
        }}
      >
        {siblings.map((bookmark: Bookmark, index: number) => {
          const resolution = resolutions[bookmark.id];
          const broken = resolution?.state === 'unresolved', unavailable = resolution?.state === 'unavailable';
          return (
            <div
              key={bookmark.id}
              className='bookmark-entry'
              draggable={canEdit}
              onDragStart={event => {
                event.stopPropagation();
                event.dataTransfer.setData('text/plain', bookmark.id);
                setDrag({ kind: 'bookmark', id: bookmark.id });
              }}
              onDragEnd={() => setDrag(undefined)}
              onDragOver={event => {
                if (canEdit && drag?.kind === 'bookmark') {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onDrop={event => {
                event.preventDefault();
                event.stopPropagation();
                if (canEdit && drag?.kind === 'bookmark') apply(page => moveBookmark(page, notebookId, drag.id, groupId, index));
                setDrag(undefined);
              }}
            >
              <div className='bookmark-heading'>{bookmark.target.kind === 'url' ? <a href={bookmark.target.url} target='_blank' rel='noopener noreferrer' title={t('bookmarks.external')}>{bookmark.label}{' ↗'}</a> : <button type='button' onClick={() => void context.activate(notebookId, bookmark)}>{bookmark.label}</button>}{(broken || unavailable) && <span className='bookmark-status' title={broken ? resolution.reason : t('bookmarks.unavailable')}>{t(broken ? 'bookmarks.unresolved' : 'bookmarks.unavailable')}</span>}</div>
              {unavailable && <button type='button' onClick={() => setRetry(value => value + 1)}>{t('bookmarks.retry')}</button>}
              {broken && bookmark.target.kind === 'position' && ['missing-position', 'ambiguous-position'].includes(resolution.reason) && <button type='button' onClick={() => void context.activate(notebookId, bookmark, true)}>{t('bookmarks.wholeNote')}</button>}
              {canEdit && (
                <details className='bookmark-controls'>
                  <summary aria-label={`${t('bookmarks.edit')}: ${bookmark.label}`}>{t('bookmarks.edit')}</summary>
                  <div className='bookmark-control-grid'>
                    <button type='button' onClick={() => context.request({ notebookId, id: bookmark.id })}>{t('bookmarks.retarget')}</button>
                    <button type='button' disabled={index === 0} onClick={() => apply(page => moveBookmark(page, notebookId, bookmark.id, groupId, index - 1))}>{t('bookmarks.up')}</button>
                    <button type='button' disabled={index === siblings.length - 1} onClick={() => apply(page => moveBookmark(page, notebookId, bookmark.id, groupId, index + 1))}>{t('bookmarks.down')}</button>
                    <select
                      aria-label={`${t('bookmarks.group')}: ${bookmark.label}`}
                      value={bookmark.groupId ?? ''}
                      onChange={event => {
                        const group = event.target.value || null;
                        apply(page => moveBookmark(page, notebookId, bookmark.id, group));
                      }}
                    >
                      <option value=''>{t('bookmarks.ungrouped')}</option>
                      {collection.groups.map((group: { id: string; label: string; }) => <option key={group.id} value={group.id}>{group.label}</option>)}
                    </select>
                    <button type='button' onClick={() => setDialog({ kind: 'remove-bookmark', id: bookmark.id, label: bookmark.label })}>{t('bookmarks.remove')}</button>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <section className='bookmarks-section' aria-label={t('bookmarks.title')}>
      <details
        open={open}
        onToggle={event => {
          setOpen(event.currentTarget.open);
          localStorage.setItem(key, String(event.currentTarget.open));
        }}
      >
        <summary>{t('bookmarks.title')} {!loading && !error && !repository?.unavailable && <span className='bookmark-status' title={t(context.remote ? 'bookmarks.pendingHint' : 'bookmarks.localHint')}>{t(pending ? 'bookmarks.pending' : 'bookmarks.saved')}</span>}</summary>
        {loading && <p>{t('bookmarks.loading')}</p>}
        {error && <p role='alert'>{error}</p>}
        {(error || repository?.unavailable) && (
          <button
            type='button'
            onClick={() => {
              if (live) void context.controller.refresh();
              else void query.refetch();
            }}
          >
            {t('bookmarks.retry')}
          </button>
        )}
        {live && error && pending && <button type='button' onClick={() => void context.controller.reload()}>{t('bookmarks.discard')}</button>}
        {entries(null)}
        {collection.groups.map((group: { id: string; label: string; }, index: number) => (
          <details
            key={group.id}
            className='bookmark-group'
            open
            draggable={canEdit}
            onDragStart={event => {
              event.dataTransfer.setData('text/plain', group.id);
              setDrag({ kind: 'group', id: group.id });
            }}
            onDragOver={event => {
              if (canEdit && drag?.kind === 'group') event.preventDefault();
            }}
            onDrop={event => {
              if (canEdit && drag?.kind === 'group') {
                event.preventDefault();
                apply(page => moveBookmarkGroup(page, notebookId, drag.id, index));
                setDrag(undefined);
              }
            }}
          >
            <summary>{group.label}</summary>
            {entries(group.id)}
            {canEdit && (
              <div className='bookmark-control-grid'>
                <button type='button' disabled={index === 0} onClick={() => apply(page => moveBookmarkGroup(page, notebookId, group.id, index - 1))}>{t('bookmarks.up')}</button>
                <button type='button' disabled={index === collection.groups.length - 1} onClick={() => apply(page => moveBookmarkGroup(page, notebookId, group.id, index + 1))}>{t('bookmarks.down')}</button>
                <button type='button' onClick={() => setDialog({ kind: 'rename-group', id: group.id, label: group.label })}>{t('bookmarks.renameGroup')}</button>
                <button type='button' onClick={() => setDialog({ kind: 'remove-group', id: group.id, label: group.label })}>{t('bookmarks.removeGroup')}</button>
              </div>
            )}
          </details>
        ))}
        <div className='bookmark-control-grid'>
          <button type='button' disabled={!canEdit} onClick={() => context.request({ notebookId })}>{t('bookmarks.add')}</button>
          <button type='button' disabled={!canEdit} onClick={() => setDialog({ kind: 'new-group', label: '' })}>{t('bookmarks.newGroup')}</button>
        </div>
      </details>
      {dialog && (
        <WorkspaceDialog title={t(dialog.kind === 'remove-bookmark' ? 'bookmarks.remove' : dialog.kind === 'remove-group' ? 'bookmarks.removeGroup' : dialog.kind === 'rename-group' ? 'bookmarks.renameGroup' : 'bookmarks.newGroup')} onClose={() => setDialog(undefined)}>
          <form
            className='screen-form'
            onSubmit={event => {
              event.preventDefault();
              const action = dialog;
              apply(page => action.kind === 'remove-bookmark' ? removeBookmark(page, notebookId, action.id!) : action.kind === 'remove-group' ? removeBookmarkGroup(page, notebookId, action.id!) : action.kind === 'rename-group' ? renameBookmarkGroup(page, notebookId, action.id!, action.label) : addBookmarkGroup(page, notebookId, { id: crypto.randomUUID(), label: action.label }));
              setDialog(undefined);
            }}
          >
            {dialog.kind.startsWith('remove') ? <p>{dialog.label}{' — '}{t(dialog.kind === 'remove-group' ? 'bookmarks.removeGroupHint' : 'bookmarks.removeHint')}</p> : (
              <label>
                {t('bookmarks.label')}
                <input autoFocus required maxLength={120} value={dialog.label} onChange={event => setDialog({ ...dialog, label: event.target.value })} />
              </label>
            )}
            <div className='workspace-dialog-actions'>
              <Button type='button' onClick={() => setDialog(undefined)}>{t('common.cancel')}</Button>
              <Button type='submit' disabled={!canEdit}>{t(dialog.kind.startsWith('remove') ? 'common.delete' : 'common.save')}</Button>
            </div>
          </form>
        </WorkspaceDialog>
      )}
    </section>
  );
}
