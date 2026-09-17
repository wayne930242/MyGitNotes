import React, { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState<boolean | 'last'>(false);
  const [returnFocus, setReturnFocus] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mode !== 'closed') formRef.current?.scrollIntoView({ block: 'nearest' }); }, [mode]);
  useEffect(() => {
    if (mode === 'closed' && returnFocus) { triggerRef.current?.focus(); setReturnFocus(false); }
  }, [mode, returnFocus]);
  useEffect(() => {
    if (!menuOpen || !focusFirst) return;
    menuRef.current?.scrollIntoView({ block: 'nearest' });
    focusItem(focusFirst === 'last' ? -1 : 0);
    setFocusFirst(false);
  }, [menuOpen, focusFirst]);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

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
    setReturnFocus(restoreFocus);
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

  const focusItem = (index: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items?.length) return;
    items[(index + items.length) % items.length].focus();
  };

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    setCount(null);
    setError(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(current + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(current - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusItem(0); }
    else if (event.key === 'End') { event.preventDefault(); focusItem(-1); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (event.key === 'Tab') closeMenu(false);
  };

  return (
    <div className="sidebar-tag-actions-trigger" onClick={stop} data-open={menuOpen || undefined} ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="ui-icon-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-label={t('sidebar.tagManage', { tag })}
        title={t('sidebar.tagManage', { tag })}
        onClick={() => { if (menuOpen) closeMenu(false); else { setMenuOpen(true); setFocusFirst(true); } }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setMenuOpen(true);
            setFocusFirst(event.key === 'ArrowDown' ? true : 'last');
          }
        }}
      >
        <MoreHorizontal size={12} />
      </button>
      {menuOpen && (
        <div className="sidebar-tag-menu" role="menu" id={menuId} ref={menuRef} aria-label={t('sidebar.tagManage', { tag })} onKeyDown={handleMenuKeyDown}>
          <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); void openForm('rename'); }}>{t('sidebar.tagRename')}</button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); void openForm('merge'); }}>{t('sidebar.tagMergeInto')}</button>
          <button
            type="button"
            role="menuitem"
            className="sidebar-tag-menu-danger"
            data-armed={deleteArmed || undefined}
            aria-describedby={deleteArmed || count === 0 ? `${menuId}-status` : undefined}
            disabled={busy}
            onClick={event => void handleDeleteClick(event)}
          >
            {deleteArmed && count !== null && count > 0 ? t('sidebar.tagConfirmDelete', { count }) : t('sidebar.tagDelete')}
          </button>
          {deleteArmed && count !== null && count > 0 && (
            <p id={`${menuId}-status`} role="status" className="sidebar-tag-action-error">{t('sidebar.tagConfirmDeleteAgain')}</p>
          )}
          {count === 0 && <p id={`${menuId}-status`} role="status" className="sidebar-tag-action-error">{t('sidebar.tagNoNotesAffected')}</p>}
          {error && <p role="alert" className="sidebar-tag-action-error">{t('sidebar.tagOperationFailed', { error })}</p>}
        </div>
      )}
    </div>
  );
};
