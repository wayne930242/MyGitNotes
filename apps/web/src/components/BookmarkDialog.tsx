import { useEffect, useState } from 'react';
import { type Bookmark, BookmarkError, type BookmarkTarget, BookmarkTargetSchema, type NotebookBookmarks } from '@mygitnotes/core/bookmarks';
import { type BookmarkPosition, captureTextAnchor, listBookmarkPositions } from '@mygitnotes/core/bookmark-anchor';
import type { SavedBookmarkQuery } from '@mygitnotes/core/bookmark-query';
import type { BookmarkEditRequest } from '../lib/bookmark-context.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import { useNoteList } from '../lib/use-note-queries.js';
import { readNote } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Button } from './Button.js';

interface Props {
  request: BookmarkEditRequest;
  notebook: NotebookConfig;
  collection: NotebookBookmarks;
  folders: FolderItem[];
  remote: boolean;
  writable: boolean;
  captureView: () => SavedBookmarkQuery;
  onSave: (fields: Pick<Bookmark, 'label' | 'groupId' | 'target'>) => Promise<void>;
  onEditExisting: (id: string) => void;
  onClose: () => void;
}
export function BookmarkDialog({ request, notebook, collection, folders, remote, writable, captureView, onSave, onEditExisting, onClose }: Props) {
  const { t } = useTranslation();
  const existing = collection.bookmarks.find(b => b.id === request.id);
  const initial = existing?.target ?? request.target;
  const [kind, setKind] = useState<BookmarkTarget['kind']>(initial?.kind ?? (request.positionPath ? 'position' : 'note'));
  const [label, setLabel] = useState(existing?.label ?? request.label ?? '');
  const [groupId, setGroup] = useState(existing?.groupId ?? '');
  const [path, setPath] = useState(initial && 'path' in initial ? initial.path : request.positionPath ?? '');
  const [url, setUrl] = useState(initial?.kind === 'url' ? initial.url : '');
  const [query, setQuery] = useState<SavedBookmarkQuery | undefined>(initial?.kind === 'query' ? initial.query : undefined);
  const [anchor, setAnchor] = useState(initial?.kind === 'position' ? initial.anchor : undefined);
  const [search, setSearch] = useState('');
  const [positions, setPositions] = useState<BookmarkPosition[]>([]), [body, setBody] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [duplicate, setDuplicate] = useState<string>();
  const candidates = useNoteList(['note', 'position', 'compilation'].includes(kind) ? { notebookId: notebook.id, kind: kind === 'compilation' ? 'compilation' : 'note', q: search, showHidden: true } : null);
  useEffect(() => {
    if (kind !== 'position' || !path) return;
    let active = true;
    // eslint-disable-next-line react/set-state-in-effect -- This request lifecycle reads saved source for the chosen note and cancels stale responses.
    setLoading(true);
    readNote(`${notebook.root}/${path}`, notebook.id).then(note => {
      if (!active) return;
      setBody(note.content);
      setPositions(listBookmarkPositions(note.content, path.split('.').at(-1)));
    }).catch(caught => {
      if (active) setError((caught as Error).message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [kind, path, notebook.id, notebook.root]);
  const chooseKind = (value: BookmarkTarget['kind']) => {
    setKind(value);
    setError('');
    setDuplicate(undefined);
    if (value === 'query' && !query) {
      try {
        setQuery(captureView());
      } catch {
        setError(t('bookmarks.scopeHint'));
      }
    }
  };
  const submit = async () => {
    setError('');
    setDuplicate(undefined);
    setBusy(true);
    try {
      let target: BookmarkTarget;
      if (kind === 'url') target = { kind, url };
      else if (kind === 'query') {
        if (!query) throw new BookmarkError('invalid-target', t('bookmarks.scopeHint'));
        target = { kind, query };
      } else if (kind === 'position') {
        if (!anchor) throw new BookmarkError('invalid-position', t('bookmarks.pickPosition'));
        target = { kind, path, anchor };
      } else target = { kind, path };
      await onSave({ label, groupId: groupId || null, target: BookmarkTargetSchema.parse(target) });
    } catch (caught) {
      if (caught instanceof Error && 'existingId' in caught && typeof caught.existingId === 'string') setDuplicate(caught.existingId);
      setError(caught instanceof Error ? caught.message : t('bookmarks.saveError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WorkspaceDialog
      title={t(existing ? 'bookmarks.edit' : 'bookmarks.add')}
      onClose={() => {
        if (!busy) onClose();
      }}
      className='bookmark-dialog'
    >
      <form
        className='screen-form'
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <p>{notebook.title}</p>
        <label>
          {t('bookmarks.label')}
          <input autoFocus required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} disabled={busy || !writable} />
        </label>
        <label>
          {t('bookmarks.group')}
          <select value={groupId} onChange={event => setGroup(event.target.value)} disabled={busy || !writable}>
            <option value=''>{t('bookmarks.ungrouped')}</option>
            {collection.groups.map((group: { id: string; label: string; }) => <option key={group.id} value={group.id}>{group.label}</option>)}
          </select>
        </label>
        <label>
          {t('bookmarks.target')}
          <select value={kind} onChange={event => chooseKind(event.target.value as BookmarkTarget['kind'])} disabled={busy || !writable}>{(['note', 'folder', 'compilation', 'position', 'url', 'query'] as const).map(value => <option key={value} value={value}>{t(`bookmarks.kind.${value}`)}</option>)}</select>
        </label>
        {kind === 'url'
          ? (
            <label>
              URL<input type='url' required value={url} onChange={event => setUrl(event.target.value)} placeholder='https://' />
            </label>
          )
          : kind === 'query'
          ? (
            <>
              <p>{t('bookmarks.queryHint')}</p>
              <pre className='bookmark-query-preview'>{JSON.stringify(query, null, 2)}</pre>
              <Button
                type='button'
                onClick={() => {
                  try {
                    setQuery(captureView());
                    setError('');
                  } catch {
                    setError(t('bookmarks.scopeHint'));
                  }
                }}
              >
                {t('bookmarks.saveView')}
              </Button>
            </>
          )
          : (
            <>
              <label>
                {t('bookmarks.path')}
                <input
                  required={kind !== 'folder'}
                  value={path}
                  onChange={event => {
                    setPath(event.target.value);
                    setAnchor(undefined);
                  }}
                />
              </label>
              {kind === 'folder'
                ? (
                  <select
                    aria-label={t('bookmarks.kind.folder')}
                    value={path}
                    onChange={event => {
                      setPath(event.target.value);
                      if (!label) setLabel(event.target.selectedOptions[0].text);
                    }}
                  >
                    <option value=''>{notebook.title}</option>
                    {folders.filter(folder => folder.notebookId === notebook.id).map(folder => <option key={folder.path} value={folder.path}>{folder.title}{' · '}{folder.path}</option>)}
                  </select>
                )
                : (
                  <>
                    <input aria-label={t('bookmarks.target')} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('bookmarks.target')} />
                    <div className='bookmark-candidates'>
                      {candidates.notes.map(note => (
                        <button
                          type='button'
                          key={note.path}
                          onClick={() => {
                            setPath(note.path.slice(notebook.root.length + 1));
                            setAnchor(undefined);
                            if (!label) setLabel(note.title);
                          }}
                        >
                          {note.title}
                          <small>{note.path}</small>
                        </button>
                      ))}
                    </div>
                    {candidates.error && <p role='alert'>{candidates.error}</p>}
                    {candidates.hasMore && <Button type='button' disabled={candidates.loadingMore} onClick={candidates.loadMore}>{t('bookmarks.more')}</Button>}
                  </>
                )}
              {kind === 'position' && (
                <>
                  <label>
                    {t('bookmarks.pickPosition')}
                    <select
                      aria-label={t('bookmarks.pickPosition')}
                      value={positions.findIndex(position => anchor?.exact === body.slice(position.from, position.to))}
                      disabled={loading || busy}
                      onChange={event => {
                        const position = positions[Number(event.target.value)];
                        if (position) {
                          setAnchor(captureTextAnchor(body, position, position.kind));
                          if (!label) setLabel(position.label.slice(0, 120));
                        }
                      }}
                    >
                      <option value={-1}>{anchor ? anchor.exact.slice(0, 100) : t('bookmarks.pickPosition')}</option>
                      {positions.map((position, index) => <option key={`${position.from}:${position.to}`} value={index}>{position.label.slice(0, 160)}</option>)}
                    </select>
                  </label>
                  <p>{t(remote ? 'bookmarks.saveFirstRemote' : 'bookmarks.saveFirstLocal')}</p>
                </>
              )}
            </>
          )}
        {error && <p role='alert'>{error}</p>}
        {duplicate && <Button type='button' onClick={() => onEditExisting(duplicate!)}>{t('bookmarks.editExisting')}</Button>}
        <div className='workspace-dialog-actions'>
          <Button type='button' disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          <Button type='submit' variant='primary' disabled={!writable || busy || loading}>{t(kind === 'position' ? 'bookmarks.saveFirst' : 'common.save')}</Button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
