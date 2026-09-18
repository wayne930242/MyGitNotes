import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FileText, GalleryHorizontalEnd, Maximize2, PanelTopDashed, Plus, X } from 'lucide-react';
import { findFocusTab, focusTabKey, type FocusTab } from '@mygitnotes/core/focus-page';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { NoteFocus } from '../lib/use-note-focus.js';
import type { DisplayedPane } from '../lib/focus-view.js';
import { NOTE_DRAG_TYPE } from '../lib/note-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { NoteEditorProps } from './NoteEditor.js';
import { HostedNoteEditor } from './NoteEditorHost.js';

/** Drag payload for a tab moved inside the displayed Focus: its FocusTab as JSON. */
const TAB_DRAG_TYPE = 'application/x-mygitnotes-focus-tab';

export interface FocusPaneContext {
  focus: NoteFocus;
  /** The notebook's lanes. */
  lanes: readonly ScreenRow[];
  /** Notes dropped from outside must live under this root. */
  notebookRoot: string;
  renderLane: (row: ScreenRow, pane: number) => ReactNode;
  onZoomNote: (path: string) => void;
  /** The rail container and section the active pane's editor renders its document panel into. */
  documentPanel?: NoteEditorProps['documentPanel'];
}

interface PaneTab { tab: FocusTab; key: string; pane: number; index: number; label: string }

/** One pane on screen: its tab list and the displayed tab. On narrow screens it stands for several stored panes. */
export const FocusPane: React.FC<FocusPaneContext & { displayed: DisplayedPane }> = ({ displayed, ...context }) => {
  const { focus, lanes, notebookRoot, renderLane, onZoomNote, documentPanel } = context;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = focus.layout!, entry = focus.entry!;
  const active = displayed.panes.includes(entry.activePane);
  const editable = focus.editable;
  const tabs: PaneTab[] = displayed.panes.flatMap(pane => layout.panes[pane].tabs.map((tab, index) => ({
    tab, key: focusTabKey(tab), pane, index,
    label: tab.kind === 'note' ? focus.notes.get(tab.path)?.title || tab.path.split('/').pop()!.replace(/\.md$/, '') : lanes.find(row => row.id === tab.id)?.name || tab.id,
  })));
  const shown = tabs.find(tab => tab.key === displayed.key);
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

  const [dropping, setDropping] = useState(false);
  const accepts = (event: React.DragEvent) => editable && [TAB_DRAG_TYPE, NOTE_DRAG_TYPE, 'text/plain'].some(type => event.dataTransfer.types.includes(type));
  /** Drops before `before`, or at the end of the displayed stored pane. */
  const drop = (event: React.DragEvent, before?: PaneTab) => {
    setDropping(false);
    if (!accepts(event)) return;
    event.preventDefault(); event.stopPropagation();
    const tab = droppedTab(event.dataTransfer, notebookRoot);
    if (!tab || !focus.shown) return;
    const pane = before?.pane ?? displayed.pane;
    const found = findFocusTab(layout, focusTabKey(tab));
    const index = before && found && found.pane === before.pane && found.index < before.index ? before.index - 1 : before?.index;
    void focus.place(focus.shown, tab, pane, index);
  };

  return (
    <section className="focus-pane" data-focus-pane={displayed.pane} data-active={active || undefined} data-dropping={dropping || undefined}
      data-autohide={autoHide || undefined} aria-label={t('focus.paneNumber', { number: displayed.pane + 1 })}
      onPointerDownCapture={() => focus.activate(displayed.pane)} onFocusCapture={() => focus.activate(displayed.pane)}
      onDragOver={event => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropping(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={event => drop(event)}>
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
            <div key={tab.key} role="presentation" className="focus-tab" data-shown={tab.key === displayed.key || undefined}
              draggable={editable} onDragStart={event => {
                event.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify(tab.tab));
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={event => { if (accepts(event)) { event.preventDefault(); setDropping(true); } }}
              onDrop={event => drop(event, tab)}>
              <button type="button" role="tab" aria-selected={tab.key === displayed.key} aria-controls={panelId}
                tabIndex={tab.key === displayed.key || (!displayed.key && tab === tabs[0]) ? 0 : -1} title={tab.label}
                onClick={() => void focus.show(tab.pane, tab.key)}
                onKeyDown={event => { if (editable && event.key === 'Delete') { event.preventDefault(); void focus.close(tab.key); } }}>
                {tab.tab.kind === 'note' ? <FileText aria-hidden="true" /> : <GalleryHorizontalEnd aria-hidden="true" />}
                <span>{tab.label}</span>
              </button>
              {editable && <button type="button" className="focus-tab-close" tabIndex={-1} aria-label={t('focus.closeTab', { name: tab.label })}
                title={t('focus.closeTab', { name: tab.label })} onClick={() => void focus.close(tab.key)}><X aria-hidden="true" /></button>}
            </div>
          ))}
        </div>
        <div className="focus-pane-actions">
          {overflowing && <FocusMenu label={t('focus.allTabs')} icon={<ChevronDown aria-hidden="true" />}
            items={tabs.map(tab => ({ key: tab.key, label: tab.label, current: tab.key === displayed.key, onSelect: () => void focus.show(tab.pane, tab.key) }))} />}
          {editable && <FocusMenu label={t('focus.addLane')} showLabel icon={<Plus aria-hidden="true" />}
            items={lanes.length > 0
              ? lanes.map(row => ({ key: row.id, label: row.name, onSelect: () => { if (focus.shown) void focus.place(focus.shown, { kind: 'lane', id: row.id }, displayed.pane); } }))
              : [{ key: 'screen', label: t('focus.goAddLane'), onSelect: () => navigate(`/screen?notebook=${encodeURIComponent(focus.notebookId)}`) }]} />}
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
    </section>
  );
};

function droppedTab(data: DataTransfer, notebookRoot: string): FocusTab | undefined {
  const moved = data.getData(TAB_DRAG_TYPE);
  if (moved) {
    try {
      const tab = JSON.parse(moved) as FocusTab;
      if ((tab.kind === 'note' && typeof tab.path === 'string') || (tab.kind === 'lane' && typeof tab.id === 'string')) return tab;
    } catch { return undefined; }
  }
  const path = (data.getData(NOTE_DRAG_TYPE) || data.getData('text/plain')).trim();
  return path.startsWith(`${notebookRoot}/`) && path.endsWith('.md') ? { kind: 'note', path } : undefined;
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
