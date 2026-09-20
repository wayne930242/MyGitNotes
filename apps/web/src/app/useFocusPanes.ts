import { useLocation, useNavigate } from 'react-router-dom';
import { parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import { type FocusTab } from '@mygitnotes/core/focus-page';
import { useNoteFocus } from '../lib/use-note-focus.js';
import { displayedPanes } from '../lib/focus-view.js';
import { usePaneCapacity } from '../components/FocusArea.js';
import { type DocumentToolId, isDocumentTool, usePanelContext } from '../lib/panel-context.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  screen: WorkspaceState['screen'];
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  focusPage: WorkspaceState['focus'];
  remote: WorkspaceState['remote'];
  sourceId: WorkspaceState['sourceId'];
  repoRoot: WorkspaceState['repoRoot'];
  activeTab: WorkspaceTab;
  route: ReturnType<typeof parseWorkspaceRoute>;
  canWrite: WorkspaceState['canWrite'];
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  loading: WorkspaceState['loading'];
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
}

export function useFocusPanes({ screen, selectedNotebookId, focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite, editorRegistry, location, navigate, loading, editorRoute }: Params) {
  // Focus: the URL names the displayed one; named Focus sync through their workspace document.
  const focusCapacity = usePaneCapacity();
  const notebookLanes = useMemo(() => screen.loading || screen.error ? undefined : screen.page.rows.filter(row => row.notebookId === selectedNotebookId), [screen.loading, screen.error, screen.page, selectedNotebookId]);
  const noteFocus = useNoteFocus({ page: focusPage, notebookId: selectedNotebookId, scope: remote ? sourceId : `local:${repoRoot}`, focusKey: activeTab === 'notes' ? route.focus : null, writable: canWrite, lanes: notebookLanes, flushEditors: editorRegistry.flushEditors });
  const focusDisplay = noteFocus.layout && noteFocus.entry ? displayedPanes(noteFocus.entry, noteFocus.layout, focusCapacity) : undefined;
  /** On phones the browse region and the Focus take turns filling the screen. */
  const [focusNarrowView, setFocusNarrowView] = useState<'focus' | 'browse'>('focus');
  const [addingToFocus, setAddingToFocus] = useState<{ tab: FocusTab; label: string; } | null>(null);
  // The rail shows the active pane's document panel when that pane displays a note.
  const panel = usePanelContext();
  const [documentContainer, setDocumentContainer] = useState<HTMLDivElement | null>(null);
  const activePaneNote = Boolean(noteFocus.entry && focusDisplay?.panes.find(pane => pane.panes.includes(noteFocus.entry!.activePane))?.key?.startsWith('note:'));
  const focusDocumentPanel = {
    target: documentContainer,
    mode: panel.isOpen && isDocumentTool(panel.activeTool) ? panel.activeTool : null,
    onChange: (mode: DocumentToolId | null) => {
      if (!mode) panel.close();
      else if (!panel.isOpen || panel.activeTool !== mode) panel.openTool(mode);
    },
  };
  /** Shows a Focus (`current` or an id), or returns to normal browsing with null. */
  const showFocus = async (key: string | null) => {
    if (!await editorRegistry.flushEditors()) return;
    if (!key) noteFocus.forget();
    const query = new URLSearchParams(location.search);
    if (key) query.set('focus', key);
    else query.delete('focus');
    setFocusNarrowView('focus');
    navigate({ pathname: location.pathname, search: query.toString() });
  };
  // Arriving at a notebook's Notes page shows the Focus it displayed last.
  const focusArrival = useRef('');

  useEffect(() => {
    if (activeTab !== 'notes') {
      focusArrival.current = '';
      return;
    }
    if (loading || editorRoute.note) return;
    const arrival = `${sourceId}:${selectedNotebookId}`;
    if (focusArrival.current === arrival) return;
    focusArrival.current = arrival;
    if (route.focus || !noteFocus.view.last) return;
    const query = new URLSearchParams(location.search);
    query.set('focus', noteFocus.view.last);
    navigate({ pathname: location.pathname, search: query.toString() }, { replace: true });
  }, [activeTab, loading, editorRoute.note, sourceId, selectedNotebookId, route.focus, noteFocus.view.last, location.search, location.pathname, navigate]);

  return { focusCapacity, notebookLanes, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, focusDocumentPanel, setDocumentContainer, showFocus };
}
