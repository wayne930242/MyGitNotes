import { ReorderToggle } from './ReorderToggle.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { Folder, FolderPlus, GripVertical, MoreHorizontal, Check } from 'lucide-react';
import type { FolderCommand } from '@mygitnotes/core';
import type { FolderItem } from '../lib/types.js';
import { folderDropCommand } from '../lib/folder-drag.js';
import { resolveFolderClick, buildFolderTree, expandedPathsForFolder, type FolderTreeNode } from '../lib/folder-tree.js';
import { useLongPress } from '../lib/use-long-press.js';
import { useTranslation } from '../lib/i18n/index.js';
import { NavTree, NavTreeRow, NavTreeChildren } from './NavTree.js';

function DropZone({ path, position, disabled, children }: { path: string; position: 'before' | 'after' | 'inside'; disabled: boolean; children?: React.ReactNode }) {
  const drop = useDroppable({ id: `${position}:${path}`, disabled, data: { path, position } });
  return <div ref={drop.setNodeRef} data-folder-drop={`${position}:${path}`} className={`${position === 'inside' ? 'folder-drop-body' : 'folder-drop-line'} ${drop.isOver ? 'is-over' : ''}`}>{children}</div>;
}

function TreeItem({
  folder,
  reorder,
  disabled,
  selected,
  onSelect,
  onManage,
  multiSelectable,
  touchMultiSelect,
  onLongPress,
  hasChildren,
  isExpanded,
  onToggleExpand,
}: {
  folder: FolderItem;
  reorder: boolean;
  disabled: boolean;
  selected: boolean;
  onSelect: (event: { shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onManage: () => void;
  multiSelectable: boolean;
  touchMultiSelect?: boolean;
  onLongPress?: () => void;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: (event: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const drag = useDraggable({ id: folder.path, disabled: disabled || !reorder });
  const longPress = useLongPress(() => onLongPress?.(), multiSelectable && Boolean(onLongPress));
  const title = `${folder.description || folder.path}${
    touchMultiSelect
      ? ` (${t('folder.touchMultiSelectInstruction')})`
      : multiSelectable
      ? ` (${t('folder.multiSelectHint')})`
      : ''
  }`;

  return (
    <div ref={drag.setNodeRef} className={`folder-tree-item ${selected ? 'is-selected' : ''}`} style={{ opacity: drag.isDragging ? 0.35 : undefined }}>
      <DropZone path={folder.path} position="before" disabled={disabled || !reorder} />
      <DropZone path={folder.path} position="inside" disabled={disabled || !reorder}>
        <NavTreeRow
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          expandAriaLabel={isExpanded ? t('folder.collapse') : t('folder.expand')}
          title={folder.title}
          selected={selected}
          onSelect={longPress.onClick(onSelect)}
          entryClassName={longPress.isPressing ? 'is-pressing' : ''}
          prefix={
            !disabled && reorder ? (
              <button
                type="button"
                className="folder-grip"
                ref={drag.setActivatorNodeRef}
                {...drag.listeners}
                {...drag.attributes}
                aria-label={`${t('folder.move')}: ${folder.title}`}
              >
                <GripVertical size={12} />
              </button>
            ) : undefined
          }
          suffix={
            touchMultiSelect ? (
              <span className={`folder-check ${selected ? 'is-checked' : ''}`} aria-hidden="true">
                {selected && <Check size={11} strokeWidth={3} />}
              </span>
            ) : undefined
          }
          actions={
            !disabled ? (
              <button
                type="button"
                className="folder-manage"
                aria-label={`${t('folder.manage')}: ${folder.title}`}
                title={t('folder.manage')}
                onClick={onManage}
              >
                <MoreHorizontal size={15} />
              </button>
            ) : undefined
          }
          buttonProps={{
            title,
            onContextMenu: longPress.onContextMenu,
            onTouchStart: longPress.onTouchStart,
            onTouchMove: longPress.onTouchMove,
            onTouchEnd: longPress.onTouchEnd,
            onTouchCancel: longPress.onTouchCancel,
          }}
        />
      </DropZone>
      <DropZone path={folder.path} position="after" disabled={disabled || !reorder} />
    </div>
  );
}

function TreeBranch({
  node,
  expanded,
  onToggleExpand,
  reorder,
  disabled,
  isSelected,
  selectFolder,
  onManageFiles,
  multiSelectable,
  touchMultiSelect,
  onLongPressFolder,
}: {
  node: FolderTreeNode;
  expanded: Set<string>;
  onToggleExpand: (path: string, event: React.MouseEvent) => void;
  reorder: boolean;
  disabled: boolean;
  isSelected: (path: string | null) => boolean;
  selectFolder: (folder: string | null, event: { shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onManageFiles: (path: string) => void;
  multiSelectable: boolean;
  touchMultiSelect?: boolean;
  onLongPressFolder?: (folder: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const folder = node.folder;

  return (
    <div className="nav-tree-node" key={node.path}>
      <TreeItem
        folder={folder}
        reorder={reorder}
        disabled={disabled}
        selected={isSelected(folder.path)}
        onSelect={event => selectFolder(folder.path, event)}
        onManage={() => onManageFiles(folder.path)}
        multiSelectable={multiSelectable}
        touchMultiSelect={touchMultiSelect}
        onLongPress={onLongPressFolder && (() => onLongPressFolder(folder.path))}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        onToggleExpand={event => onToggleExpand(node.path, event)}
      />
      {hasChildren && isExpanded && (
        <NavTreeChildren>
          {node.children.map(child => (
            <TreeBranch
              key={child.path}
              node={child}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              reorder={reorder}
              disabled={disabled}
              isSelected={isSelected}
              selectFolder={selectFolder}
              onManageFiles={onManageFiles}
              multiSelectable={multiSelectable}
              touchMultiSelect={touchMultiSelect}
              onLongPressFolder={onLongPressFolder}
            />
          ))}
        </NavTreeChildren>
      )}
    </div>
  );
}

export function FolderTree({
  showHeading = false,
  showRoot = false,
  onManageFiles,
  reorder = false,
  onToggleReorder,
  selectedPaths,
  allFoldersSelected,
  onFilterFolder,
  touchMultiSelect = false,
  onLongPressFolder,
  folders,
  notebookId,
  selected,
  onSelect,
  writable,
  beforeChange,
  onChanged,
  expandCommand,
}: {
  showHeading?: boolean;
  showRoot?: boolean;
  onManageFiles: (path: string) => void;
  reorder?: boolean;
  onToggleReorder?: () => void;
  selectedPaths?: string[];
  allFoldersSelected?: boolean;
  onFilterFolder?: (folder: string | null) => void;
  touchMultiSelect?: boolean;
  onLongPressFolder?: (folder: string) => void;
  folders: FolderItem[];
  notebookId: string;
  selected: string | null;
  onSelect: (folder: string | null) => void;
  writable: boolean;
  beforeChange?: () => void;
  onChanged?: () => Promise<void>;
  /** Each new object expands or collapses every folder once. */
  expandCommand?: { expanded: boolean };
}) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<string>();

  const tree = useMemo(() => buildFolderTree(folders, notebookId), [folders, notebookId]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const targets = selected ? [selected] : selectedPaths || [];
    for (const target of targets) {
      for (const p of expandedPathsForFolder(target)) initial.add(p);
    }
    return initial;
  });

  useEffect(() => {
    const targets = selected ? [selected] : selectedPaths || [];
    if (!targets.length) return;
    setExpanded(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const target of targets) {
        for (const p of expandedPathsForFolder(target)) {
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [selected, selectedPaths]);

  // A tree mounted after the last command keeps its selection-based expansion.
  const appliedExpandCommand = useRef(expandCommand);
  useEffect(() => {
    if (!expandCommand || expandCommand === appliedExpandCommand.current) return;
    appliedExpandCommand.current = expandCommand;
    const paths = (nodes: FolderTreeNode[]): string[] => nodes.flatMap(node => [node.path, ...paths(node.children)]);
    setExpanded(expandCommand.expanded ? new Set(paths(tree)) : new Set());
  }, [expandCommand]);

  const toggleExpand = (path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectFolder = (folder: string | null, event: { shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean }) =>
    resolveFolderClick(event, onSelect, onFilterFolder, touchMultiSelect)(folder);

  const isSelected = (path: string | null) =>
    selectedPaths ? (path === null ? allFoldersSelected ?? selectedPaths.length === 0 : selectedPaths.includes(path)) : selected === path;

  const list = useMemo(() => folders.filter(folder => folder.notebookId === notebookId), [folders, notebookId]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const refresh = async () => {
    const response = await fetch('/api/folder-manager');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('folder.failed'));
    setRevision(data.revision);
    return data.revision as string;
  };

  useEffect(() => {
    setError('');
    setRevision('');
    if (writable) void refresh().catch(err => setError(err.message));
  }, [notebookId, folders, writable]);

  const mutate = async (command: FolderCommand) => {
    if (busy || !writable) return;
    setBusy(true);
    setError('');
    try {
      beforeChange?.();
      const response = await fetch('/api/folder-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, revision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('folder.failed'));
      setRevision(data.revision);
      await onChanged?.();
      onSelect(data.selectedPath || null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disabled = !writable || busy || !revision;
  const errorMessage = error && (
    <div role="alert" className="folder-error">
      {error}
      <button
        type="button"
        className="ui-button"
        onClick={() => {
          void refresh().then(() => {
            setError('');
            return onChanged?.();
          }).catch(err => setError(err.message));
        }}
      >
        {t('folder.reload')}
      </button>
    </div>
  );

  return (
    <section aria-label={t('folder.folders')}>
      {showHeading && (
        <div className="folder-tree-heading">
          <h4>{t('folder.folders')}</h4>
          {writable && (
            <div className="folder-heading-actions">
              {onToggleReorder && <ReorderToggle active={reorder} onToggle={onToggleReorder} disabled={busy} />}
              <button
                type="button"
                className="ui-icon-button"
                disabled={busy}
                aria-label={t('folder.create')}
                onClick={() => onManageFiles(selected || '')}
              >
                <FolderPlus size={16} />
              </button>
            </div>
          )}
        </div>
      )}
      {errorMessage}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => setDragging(String(active.id))}
        onDragCancel={() => setDragging(undefined)}
        onDragEnd={({ active, over }) => {
          setDragging(undefined);
          if (!over || disabled || !reorder) return;
          const data = over.data.current;
          const command = folderDropCommand(notebookId, String(active.id), data?.path || '', data?.position || 'inside', list);
          if (command) void mutate(command);
        }}
      >
        <NavTree aria-label={t('folder.folders')}>
          {showRoot && (
            <DropZone path="" position="inside" disabled={disabled || !reorder}>
              <NavTreeRow
                hasChildren={false}
                title={t('folder.allFolders')}
                selected={isSelected(null)}
                onSelect={event => selectFolder(null, event)}
              />
            </DropZone>
          )}
          {tree.map(rootNode => (
            <TreeBranch
              key={rootNode.path}
              node={rootNode}
              expanded={expanded}
              onToggleExpand={toggleExpand}
              reorder={reorder}
              disabled={disabled}
              isSelected={isSelected}
              selectFolder={selectFolder}
              onManageFiles={onManageFiles}
              multiSelectable={Boolean(onFilterFolder)}
              touchMultiSelect={touchMultiSelect}
              onLongPressFolder={onLongPressFolder}
            />
          ))}
        </NavTree>
        <DragOverlay>
          {dragging && (
            <div className="screen-drag-overlay">
              <Folder size={16} />
              {list.find(folder => folder.path === dragging)?.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
