import React, { useEffect, useId, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { useLongPress } from '../lib/use-long-press.js';
import { filterTagCandidates } from '../lib/tag-list.js';
import { Button } from './Button.js';

type Mode = 'closed' | 'rename' | 'merge';

interface TagActionsProps {
  tag: string;
  allTags: string[];
  onPreviewUsage: (tag: string) => Promise<number>;
  onRename: (from: string, to: string) => Promise<void>;
  onMerge: (from: string, into: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
  /** The tag's filter chip; long-pressing it on touch opens the menu. */
  children: React.ReactNode;
}

/** Rename/merge/delete controls for one tag, shown next to its chip in the Sidebar's Tags Cloud. */
export const TagActions: React.FC<TagActionsProps> = ({ tag, allTags, onPreviewUsage, onRename, onMerge, onDelete, children }) => {
  const { t, language } = useTranslation();
  const [mode, setMode] = useState<Mode>('closed');
  const [targetName, setTargetName] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState(false);
  const [portal, setPortal] = useState<HTMLElement>();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingFormRef = useRef(false);
  const openedByLongPressRef = useRef(false);
  const chipRef = useRef<HTMLSpanElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const suggestionsId = useId();
  useEffect(() => { setPortal(triggerRef.current?.closest('dialog') || undefined); }, [mode]);
  useEffect(() => { if (mode !== 'closed') formRef.current?.scrollIntoView({ block: 'nearest' }); }, [mode]);
  useEffect(() => {
    if (mode === 'closed' && returnFocus) { triggerRef.current?.focus(); setReturnFocus(false); }
  }, [mode, returnFocus]);
  const menuId = useId();
  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu } = useLongPress(() => { openedByLongPressRef.current = true; setMenuOpen(true); }, true);

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
    const requestId = ++previewRequestRef.current;
    setMode(next);
    setTargetName('');
    setError(null);
    setCount(null);
    setPreviewLoading(true);
    try {
      const usage = await onPreviewUsage(tag);
      if (previewRequestRef.current !== requestId) return;
      setCount(usage);
    } catch (err) {
      if (previewRequestRef.current !== requestId) return;
      setError((err as Error).message);
    } finally {
      if (previewRequestRef.current === requestId) setPreviewLoading(false);
    }
  };

  const close = (restoreFocus = false) => {
    previewRequestRef.current += 1;
    setReturnFocus(restoreFocus);
    setMode('closed');
    setError(null);
    setCount(null);
    setTargetName('');
    setPreviewLoading(false);
    setSuggestionsOpen(false);
    setHighlight(-1);
  };

  const trimmedTarget = targetName.trim();
  const sameName = trimmedTarget.length > 0 && trimmedTarget === tag;
  const suggestions = mode === 'merge' ? filterTagCandidates(allTags, tag, targetName, language) : [];
  const isNewTarget = mode === 'merge' && trimmedTarget.length > 0 && !sameName
    && !allTags.some(candidate => candidate.toLocaleLowerCase(language) === trimmedTarget.toLocaleLowerCase(language));
  const showSuggestions = mode === 'merge' && suggestionsOpen && suggestions.length > 0;

  const selectSuggestion = (value: string) => {
    setTargetName(value);
    setSuggestionsOpen(false);
    setHighlight(-1);
  };

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

  const handleDeleteClick = async () => {
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

  const handleOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) return;
    if (!deleteArmed) setCount(null);
    setError(null);
  };

  const selectForm = (event: Event, next: 'rename' | 'merge') => {
    if (busy) { event.preventDefault(); return; }
    openingFormRef.current = true;
    void openForm(next);
  };

  if (mode !== 'closed') {
    return (
      <div className="sidebar-tag-action-form" ref={formRef} onClick={stop} role="group" aria-label={mode === 'rename' ? t('sidebar.tagRenameTitle', { tag }) : t('sidebar.tagMergeTitle', { tag })}>
        <span className="sidebar-tag-action-target">
          {mode === 'rename' ? t('sidebar.tagRenameTitle', { tag }) : t('sidebar.tagMergeTitle', { tag })}
        </span>
        <div className="sidebar-tag-action-combobox">
          <input
            type="text"
            autoFocus
            value={targetName}
            role={mode === 'merge' ? 'combobox' : undefined}
            aria-expanded={mode === 'merge' ? showSuggestions : undefined}
            aria-controls={mode === 'merge' ? suggestionsId : undefined}
            aria-autocomplete={mode === 'merge' ? 'list' : undefined}
            aria-activedescendant={mode === 'merge' && highlight >= 0 ? `${suggestionsId}-${highlight}` : undefined}
            onChange={event => {
              setTargetName(event.target.value);
              setSuggestionsOpen(true);
              setHighlight(-1);
            }}
            placeholder={mode === 'rename' ? t('sidebar.tagNewNamePlaceholder') : t('sidebar.tagMergeTargetPlaceholder')}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                if (showSuggestions) { setSuggestionsOpen(false); setHighlight(-1); return; }
                close(true);
                return;
              }
              if (showSuggestions) {
                if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(prev => (prev + 1) % suggestions.length); return; }
                if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(prev => (prev - 1 + suggestions.length) % suggestions.length); return; }
                if (event.key === 'Enter' && highlight >= 0) { event.preventDefault(); selectSuggestion(suggestions[highlight]); return; }
              }
              if (event.key === 'Enter') void submit();
            }}
          />
          {showSuggestions && (
            <ul className="sidebar-tag-action-suggestions" role="listbox" id={suggestionsId} aria-label={t('sidebar.tagSuggestions')}>
              {suggestions.map((candidate, index) => (
                <li
                  key={candidate}
                  id={`${suggestionsId}-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  data-highlighted={index === highlight || undefined}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectSuggestion(candidate)}
                  onTouchEnd={() => selectSuggestion(candidate)}
                >
                  {candidate}
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="sidebar-tag-action-count" role="status">
          {previewLoading || count === null ? '…' : t('sidebar.tagAffectedCount', { count })}
        </span>
        {isNewTarget && !showSuggestions && <p role="status" className="sidebar-tag-action-hint">{t('sidebar.tagMergeNewTarget', { tag: trimmedTarget })}</p>}
        {sameName && <p role="alert" className="sidebar-tag-action-error">{t('sidebar.tagSameNameError')}</p>}
        {error && <p role="alert" className="sidebar-tag-action-error">{t('sidebar.tagOperationFailed', { error })}</p>}
        <div className="sidebar-tag-action-buttons">
          <button type="button" className="ui-button" disabled={busy} onClick={() => close(true)}>{t('common.cancel')}</button>
          <Button
            variant="primary"
            disabled={busy || previewLoading || !trimmedTarget || sameName || count === null || count === 0}
            onClick={() => void submit()}
          >
            {mode === 'rename' ? t('sidebar.tagConfirmRename', { count: count ?? 0 }) : t('sidebar.tagConfirmMerge', { count: count ?? 0 })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={handleOpenChange}>
      <span className="sidebar-tag-chip" ref={chipRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel} onContextMenu={onContextMenu}>{children}</span>
      <span className="sidebar-tag-actions-trigger" onClick={stop} data-open={menuOpen || undefined}>
        <DropdownMenu.Trigger
          ref={triggerRef}
          className="ui-icon-button"
          aria-label={t('sidebar.tagManage', { tag })}
          title={t('sidebar.tagManage', { tag })}
        >
          <MoreHorizontal size={12} />
        </DropdownMenu.Trigger>
      </span>
      <DropdownMenu.Portal container={portal}>
        <DropdownMenu.Content
          className="sidebar-tag-menu"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label={t('sidebar.tagManage', { tag })}
          onClick={stop}
          onEscapeKeyDown={event => event.stopPropagation()}
          onCloseAutoFocus={event => {
            const longPressed = openedByLongPressRef.current;
            openedByLongPressRef.current = false;
            if (openingFormRef.current) { event.preventDefault(); openingFormRef.current = false; }
            else if (longPressed) { event.preventDefault(); chipRef.current?.querySelector('button')?.focus(); }
          }}
        >
          <DropdownMenu.Item aria-disabled={busy} onSelect={event => selectForm(event, 'rename')}>{t('sidebar.tagRename')}</DropdownMenu.Item>
          <DropdownMenu.Item aria-disabled={busy} onSelect={event => selectForm(event, 'merge')}>{t('sidebar.tagMergeInto')}</DropdownMenu.Item>
          <DropdownMenu.Item
            className="sidebar-tag-menu-danger"
            data-armed={deleteArmed || undefined}
            aria-describedby={deleteArmed || count === 0 ? `${menuId}-status` : undefined}
            aria-disabled={busy}
            onSelect={event => { event.preventDefault(); if (!busy) void handleDeleteClick(); }}
          >
            {deleteArmed && count !== null && count > 0 ? t('sidebar.tagConfirmDelete', { count }) : t('sidebar.tagDelete')}
          </DropdownMenu.Item>
          {deleteArmed && count !== null && count > 0 && (
            <p id={`${menuId}-status`} role="status" className="sidebar-tag-action-error">{t('sidebar.tagConfirmDeleteAgain')}</p>
          )}
          {count === 0 && <p id={`${menuId}-status`} role="status" className="sidebar-tag-action-error">{t('sidebar.tagNoNotesAffected')}</p>}
          {error && <p role="alert" className="sidebar-tag-action-error">{t('sidebar.tagOperationFailed', { error })}</p>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
