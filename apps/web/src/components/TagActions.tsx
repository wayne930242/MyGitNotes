import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Merge, Trash2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { Button } from './Button.js';

type Mode = 'closed' | 'rename' | 'merge';

interface TagActionsProps {
  tag: string;
  onPreviewUsage: (tag: string) => Promise<number>;
  onRename: (from: string, to: string) => Promise<void>;
  onMerge: (from: string, into: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
}

/** Rename/merge/delete controls for one tag, shown next to its chip in the Sidebar's Tags Cloud. */
export const TagActions: React.FC<TagActionsProps> = ({ tag, onPreviewUsage, onRename, onMerge, onDelete }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('closed');
  const [targetName, setTargetName] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnFocusTo = useRef<'rename' | 'merge' | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mode !== 'closed') formRef.current?.scrollIntoView({ block: 'nearest' }); }, [mode]);

  const { pendingDeletePath, requestDelete } = useDeleteConfirm(true, async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete(tag);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setCount(null);
    }
  });
  const deleteArmed = pendingDeletePath === tag;

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  const openForm = async (next: 'rename' | 'merge') => {
    setMode(next);
    setTargetName('');
    setError(null);
    setCount(null);
    setBusy(true);
    try {
      setCount(await onPreviewUsage(tag));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = (restoreFocus = false) => {
    returnFocusTo.current = restoreFocus && mode !== 'closed' ? mode : null;
    setMode('closed');
    setError(null);
    setCount(null);
    setTargetName('');
  };

  const trimmedTarget = targetName.trim();
  const sameName = trimmedTarget.length > 0 && trimmedTarget === tag;

  const submit = async () => {
    if (!trimmedTarget || sameName) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'rename') await onRename(tag, trimmedTarget);
      else if (mode === 'merge') await onMerge(tag, trimmedTarget);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteClick = async (event: React.MouseEvent) => {
    stop(event);
    if (!deleteArmed) {
      setBusy(true);
      setError(null);
      try {
        const usage = await onPreviewUsage(tag);
        setCount(usage);
        if (usage === 0) {
          setBusy(false);
          return;
        }
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    requestDelete(tag);
  };

  if (mode !== 'closed') {
    return (
      <div className="sidebar-tag-action-form" ref={formRef} onClick={stop} role="group" aria-label={mode === 'rename' ? t('sidebar.tagRenameTitle', { tag }) : t('sidebar.tagMergeTitle', { tag })}>
        <input
          type="text"
          autoFocus
          value={targetName}
          onChange={event => setTargetName(event.target.value)}
          placeholder={mode === 'rename' ? t('sidebar.tagNewNamePlaceholder') : t('sidebar.tagMergeTargetPlaceholder')}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(true); }
            if (event.key === 'Enter') void submit();
          }}
        />
        <span className="sidebar-tag-action-count" role="status">
          {count === null ? '…' : t('sidebar.tagAffectedCount', { count })}
        </span>
        {sameName && <p role="alert" className="sidebar-tag-action-error">{t('sidebar.tagSameNameError')}</p>}
        {error && <p role="alert" className="sidebar-tag-action-error">{t('sidebar.tagOperationFailed', { error })}</p>}
        <div className="sidebar-tag-action-buttons">
          <button type="button" className="ui-button" disabled={busy} onClick={() => close(true)}>{t('common.cancel')}</button>
          <Button
            variant="primary"
            disabled={busy || !trimmedTarget || sameName || count === 0}
            onClick={() => void submit()}
          >
            {mode === 'rename' ? t('sidebar.tagConfirmRename', { count: count ?? 0 }) : t('sidebar.tagConfirmMerge', { count: count ?? 0 })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-tag-actions-trigger" onClick={stop} ref={node => {
      if (node && returnFocusTo.current) {
        node.querySelector<HTMLButtonElement>(`[data-tag-action="${returnFocusTo.current}"]`)?.focus();
        returnFocusTo.current = null;
      }
    }}>
      <span className="sidebar-tag-action-icons">
        <button type="button" data-tag-action="rename" className="ui-icon-button" aria-label={t('sidebar.tagManage', { tag: `${t('sidebar.tagRename')} ${tag}` })} title={t('sidebar.tagRename')} disabled={busy} onClick={() => void openForm('rename')}>
          <Pencil size={12} />
        </button>
        <button type="button" data-tag-action="merge" className="ui-icon-button" aria-label={t('sidebar.tagManage', { tag: `${t('sidebar.tagMergeInto')} ${tag}` })} title={t('sidebar.tagMergeInto')} disabled={busy} onClick={() => void openForm('merge')}>
          <Merge size={12} />
        </button>
        <button
          type="button"
          className={deleteArmed ? 'p-1 text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition' : 'ui-icon-button'}
          aria-label={deleteArmed ? t('sidebar.tagConfirmDeleteAgain') : t('sidebar.tagManage', { tag: `${t('sidebar.tagDelete')} ${tag}` })}
          title={deleteArmed ? t('sidebar.tagConfirmDeleteAgain') : t('sidebar.tagDelete')}
          disabled={busy}
          onClick={event => void handleDeleteClick(event)}
        >
          <Trash2 size={12} />
        </button>
      </span>
      {deleteArmed && count !== null && count > 0 && (
        <p role="status" className="sidebar-tag-action-error">{t('sidebar.tagConfirmDelete', { count })} · {t('sidebar.tagConfirmDeleteAgain')}</p>
      )}
      {count === 0 && <p role="status" className="sidebar-tag-action-error">{t('sidebar.tagNoNotesAffected')}</p>}
      {error && <p role="alert" className="sidebar-tag-action-error">{t('sidebar.tagOperationFailed', { error })}</p>}
    </div>
  );
};
