import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FileText, GalleryHorizontalEnd, ListPlus, Maximize2, PanelTopDashed, Plus, X } from 'lucide-react';
import { findFocusTabInPane, focusTabKey, type FocusTab } from '@mygitnotes/core/focus-page';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { NoteFocus } from '../lib/use-note-focus.js';
import type { DisplayedPane } from '../lib/focus-view.js';
import type { FolderItem } from '../lib/types.js';
import { NOTE_DRAG_TYPE } from '../lib/note-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { NoteEditorProps } from './NoteEditor.js';
import { HostedNoteEditor } from './NoteEditorHost.js';
import { BatchAddDialog } from './BatchAddDialog.js';

/** Drag payload for a tab moved inside the displayed Focus: its FocusTab and the pane it was dragged from, as JSON. */
const TAB_DRAG_TYPE = 'application/x-mygitnotes-focus-tab';

export interface FocusPaneContext {
  focus: NoteFocus;
  /** The notebook's lanes. */
  lanes: readonly ScreenRow[];
  /** Notes dropped from outside must live under this root. */
  notebookRoot: string;
  /** The notebook's configured folders, for the batch-add picker. */
  folders: readonly FolderItem[];
  renderLane: (row: ScreenRow, pane: number) => ReactNode;
  onZoomNote: (path: string) => void;
  /** The rail container and section the active pane's editor renders its document panel into. */
  documentPanel?: NoteEditorProps['documentPanel'];
}

interface PaneTab { tab: FocusTab; key: string; pane: number; index: number; label: string }
/** Where a drop lands: before `index` of stored `pane`, or at its end without one. */
interface DropSlot { pane: number; index?: number }

/** One pane on screen: its tab list and the displayed tab. On narrow screens it stands for several stored panes. */
export const FocusPane: React.FC<FocusPaneContext & { displayed: DisplayedPane }> = ({ displayed, ...context }) => {
  const { focus, lanes, notebookRoot, folders, renderLane, onZoomNote, documentPanel } = context;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = focus.layout!, entry = focus.entry!;
  const active = displayed.panes.includes(entry.activePane);
  const editable = focus.editable;
  const tabs: PaneTab[] = displayed.panes.flatMap(pane => layout.panes[pane].tabs.map((tab, index) => ({
    tab, key: focusTabKey(tab), pane, index,
    label: tab.kind === 'note' ? focus.notes.get(tab.path)?.title || tab.path.split('/').pop()!.replace(/\.md$/, '') : lanes.find(row => row.id === tab.id)?.name || tab.id,
  })));
  const repeatedLabels = new Set(tabs.filter((tab, index) => tabs.findIndex(candidate => candidate.label === tab.label) !== index).map(tab => tab.label));
  const shown = tabs.find(tab => tab.pane === displayed.pane && tab.key === displayed.key);
  const lane = shown?.tab.kind === 'lane' ? lanes.find(row => shown.tab.kind === 'lane' && row.id === shown.tab.id) : undefined;
  const panelId = `focus-pane-${displayed.pane}`;
  const autoHide = entry.autoHide[displayed.pane];

  const list = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tabs.length]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [displayed.key]);

  const [slot, setSlot] = useState<DropSlot>();
  const [batchAddOpen, setBatchAddOpen] = useState(false);
  const accepts = (event: React.DragEvent) => editable && [TAB_DRAG_TYPE, NOTE_DRAG_TYPE, 'text/plain'].some(type => event.dataTransfer.types.includes(type));
  const hover = (event: React.DragEvent, next: DropSlot) => {
    if (!accepts(event)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = event.shiftKey ? 'copy' : 'move';
    setSlot(current => current?.pane === next.pane && current.index === next.index ? current : next);
  };
  /** Over a tab, the half under the pointer picks the gap before or after it. */
  const slotAt = (event: React.DragEvent, tab: PaneTab): DropSlot => {
    const box = event.currentTarget.getBoundingClientRect();
    return { pane: tab.pane, index: event.clientX > box.left + box.width / 2 ? tab.index + 1 : tab.index };
  };
  /** The insertion line sits before the tab at the slot, or after the last tab of its pane. */
  const marker = (tab: PaneTab) => {
    if (!slot || tab.pane !== slot.pane) return undefined;
    if (tab.index === slot.index) return 'before';
    const count = layout.panes[tab.pane].tabs.length;
    return tab.index === count - 1 && (slot.index === undefined || slot.index >= count) ? 'after' : undefined;
  };
  /** A tab-bar drag moves by default; Shift copies instead. A browse-row drag (no source pane) always copies. Same-pane drops always reorder. */
  const drop = (event: React.DragEvent, target: DropSlot) => {
    setSlot(undefined);
    if (!accepts(event)) return;
    event.preventDefault(); event.stopPropagation();
    const dropped = droppedTab(event.dataTransfer, notebookRoot);
    if (!dropped || !focus.shown) return;
    const { tab, pane: sourcePane } = dropped;
    const key = focusTabKey(tab);
    const existingIndex = findFocusTabInPane(layout, target.pane, key);
    const index = target.index !== undefined && existingIndex !== -1 && existingIndex < target.index ? target.index - 1 : target.index;
    // The target pane already holding this tab has nothing to move or copy; the modifier key is irrelevant.
    if (sourcePane !== undefined && sourcePane !== target.pane && existingIndex === -1 && !event.shiftKey) {
      void focus.moveTab(focus.shown, key, sourcePane, target.pane, index).catch(() => {});
      return;
    }
    void focus.place(focus.shown, tab, target.pane, index).catch(() => {});
  };

  return (
    <section className="focus-pane" data-focus-pane={displayed.pane} data-active={active || undefined} data-dropping={slot ? true : undefined}
      data-autohide={autoHide || undefined} aria-label={t('focus.paneNumber', { number: displayed.pane + 1 })}
      onPointerDownCapture={() => focus.activate(displayed.pane)} onFocusCapture={() => focus.activate(displayed.pane)}
      onDragOver={event => hover(event, { pane: displayed.pane })}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSlot(undefined); }}
      onDrop={event => drop(event, { pane: displayed.pane })}>
      <div className="focus-pane-bar">
        <div ref={list} className="focus-tabs" role="tablist" aria-label={t('focus.paneTabs', { number: displayed.pane + 1 })} onKeyDown={event => {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1 }[event.key];
          if (index < 0 || target === undefined) return;
          event.preventDefault();
          buttons[(target + buttons.length) % buttons.length].focus();
        }}>
          {tabs.map(tab => (
            <div key={`${tab.pane}:${tab.key}`} role="presentation" className="focus-tab" data-pane={tab.pane}
              data-shown={(tab.pane === displayed.pane && tab.key === displayed.key) || undefined} data-drop={marker(tab)}
              draggable={editable} onDragStart={event => {
                event.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify({ tab: tab.tab, pane: tab.pane }));
                event.dataTransfer.effectAllowed = 'copyMove';
              }}
              onDragOver={event => hover(event, slotAt(event, tab))}
              onDrop={event => drop(event, slotAt(event, tab))}>
              <button type="button" role="tab" aria-selected={tab.pane === displayed.pane && tab.key === displayed.key} aria-controls={panelId}
                tabIndex={(tab.pane === displayed.pane && tab.key === displayed.key) || (!displayed.key && tab === tabs[0]) ? 0 : -1} title={tab.label}
                onClick={() => void focus.show(tab.pane, tab.key)}
                onKeyDown={event => { if (editable && event.key === 'Delete') { event.preventDefault(); void focus.close(tab.key, tab.pane).catch(() => {}); } }}>
                {tab.tab.kind === 'note' ? <FileText aria-hidden="true" /> : <GalleryHorizontalEnd aria-hidden="true" />}
                <span>{tab.label}</span>
                {repeatedLabels.has(tab.label) && <small className="focus-tab-pane" aria-hidden="true">{t('focus.paneShort', { number: tab.pane + 1 })}</small>}
              </button>
              {editable && <button type="button" className="focus-tab-close" tabIndex={-1} aria-label={t('focus.closeTab', { name: tab.label })}
                title={t('focus.closeTab', { name: tab.label })} onClick={() => void focus.close(tab.key, tab.pane).catch(() => {})}><X aria-hidden="true" /></button>}
            </div>
          ))}
        </div>
        <div className="focus-pane-actions">
          {overflowing && <FocusMenu label={t('focus.allTabs')} icon={<ChevronDown aria-hidden="true" />}
            items={tabs.map(tab => ({ key: `${tab.pane}:${tab.key}`, label: tab.label, current: tab.pane === displayed.pane && tab.key === displayed.key, onSelect: () => void focus.show(tab.pane, tab.key) }))} />}
          {editable && <FocusMenu label={t('focus.addLane')} showLabel icon={<Plus aria-hidden="true" />}
            items={lanes.length > 0
              ? lanes.map(row => ({ key: row.id, label: row.name, onSelect: () => { if (focus.shown) void focus.place(focus.shown, { kind: 'lane', id: row.id }, displayed.pane).catch(() => {}); } }))
              : [{ key: 'screen', label: t('focus.goAddLane'), onSelect: () => navigate(`/screen?notebook=${encodeURIComponent(focus.notebookId)}`) }]} />}
          {editable && <button type="button" className="ui-icon-button" aria-label={t('focus.batchAdd')} title={t('focus.batchAdd')}
            onClick={() => setBatchAddOpen(true)}><ListPlus aria-hidden="true" /></button>}
          {shown?.tab.kind === 'note' && <button type="button" className="ui-icon-button" aria-label={t('focus.zoomNote')} title={t('focus.zoomNote')}
            onClick={() => shown.tab.kind === 'note' && onZoomNote(shown.tab.path)}><Maximize2 aria-hidden="true" /></button>}
          <button type="button" className="ui-icon-button focus-pane-autohide" aria-pressed={autoHide} aria-label={t('focus.autoHideTabs')} title={t('focus.autoHideTabs')}
            onClick={() => focus.setAutoHide(displayed.pane, !autoHide)}><PanelTopDashed aria-hidden="true" /></button>
        </div>
      </div>
      <div id={panelId} className="focus-pane-body" role="tabpanel" aria-label={shown?.label}>
        {shown?.tab.kind === 'note'
          ? <PaneNoteEditor key={shown.tab.path} path={shown.tab.path} active={active} documentPanel={active ? documentPanel : undefined} />
          : lane ? renderLane(lane, displayed.pane)
          : <p className="focus-pane-empty">{editable ? t('focus.emptyPane') : t('focus.emptyPaneReadonly')}</p>}
      </div>
      {batchAddOpen && focus.shown && <BatchAddDialog focus={focus} target={focus.shown} pane={displayed.pane}
        notebookId={focus.notebookId} notebookRoot={notebookRoot} folders={folders} onClose={() => setBatchAddOpen(false)} />}
    </section>
  );
};

/** A dropped tab: its FocusTab, and (for a tab-bar drag) the pane it came from — undefined for a browse-row drag, which always copies. */
interface DroppedTab { tab: FocusTab; pane?: number }

function droppedTab(data: DataTransfer, notebookRoot: string): DroppedTab | undefined {
  const moved = data.getData(TAB_DRAG_TYPE);
  if (moved) {
    try {
      const { tab, pane } = JSON.parse(moved) as { tab: FocusTab; pane: number };
      if (typeof pane === 'number' && ((tab.kind === 'note' && typeof tab.path === 'string') || (tab.kind === 'lane' && typeof tab.id === 'string'))) return { tab, pane };
    } catch { /* falls through to undefined */ }
    return undefined;
  }
  const path = (data.getData(NOTE_DRAG_TYPE) || data.getData('text/plain')).trim();
  return path.startsWith(`${notebookRoot}/`) && path.endsWith('.md') ? { tab: { kind: 'note', path } } : undefined;
}

const FocusMenu: React.FC<{ label: string; showLabel?: boolean; icon: ReactNode; items: { key: string; label: string; current?: boolean; onSelect: () => void }[] }> = ({ label, showLabel, icon, items }) => (
  <DropdownMenu.Root>
    {showLabel
      ? <DropdownMenu.Trigger className="ui-button focus-menu-trigger">{icon}<span>{label}</span></DropdownMenu.Trigger>
      : <DropdownMenu.Trigger className="ui-icon-button" aria-label={label} title={label}>{icon}</DropdownMenu.Trigger>}
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="focus-menu" align="end" sideOffset={4} collisionPadding={8} aria-label={label}
        onEscapeKeyDown={event => event.stopPropagation()}>
        {items.map(item => <DropdownMenu.Item key={item.key} data-current={item.current || undefined} onSelect={item.onSelect}>{item.label}</DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

/** A note tab's editor: the pane is one host of the note, sharing its single editor with zoom and graph cards. */
const PaneNoteEditor: React.FC<{ path: string; active: boolean; documentPanel?: NoteEditorProps['documentPanel'] }> = ({ path, active, documentPanel }) =>
  <HostedNoteEditor path={path} frame="pane" active={active} documentPanel={documentPanel} />;
