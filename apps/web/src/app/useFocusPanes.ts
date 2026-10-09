import { notebookPreferences } from '../lib/notebook-preferences.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import { useState } from 'react';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import { type FocusTab } from '@mygitnotes/core/focus-page';
import { useNoteFocus } from '../lib/use-note-focus.js';
import { CURRENT_FOCUS, displayedPanes, hasStoredFocusView } from '../lib/focus-view.js';
import { parseNotebookKey } from '@mygitnotes/core/notebook-key';
import { usePaneCapacity } from '../components/FocusArea.js';
import { isDocumentTool, usePanelContext } from '../lib/panel-context.js';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import type { NotePanelMode } from '../components/note-editor/types.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  /** The id of the repository serving the selected notebook, which scopes this device's Focus view of it. */
  notebookRepository: string;
  focusPage: WorkspaceState['focus'];
  remote: WorkspaceState['remote'];
  sourceId: WorkspaceState['sourceId'];
  repoRoot: WorkspaceState['repoRoot'];
  activeTab: WorkspaceTab;
  route: ReturnType<typeof parseWorkspaceRoute>;
  /** Whether the Focus document may be saved; it lives in its repository. */
  canWrite: boolean;
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  resolveBareNotebook: WorkspaceState['resolveBareNotebook'];
}

export function useFocusPanes({ selectedNotebookId, notebookRepository, focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite, editorRegistry, location, navigate, editorRoute, resolveBareNotebook }: Params) {
  // Focus: the URL names the displayed one; named Focus sync through their workspace document.
  const focusCapacity = usePaneCapacity();
  // A view kept before notebook keys belongs to the notebook its local id stands for, as an old URL's does.
  const localId = parseNotebookKey(selectedNotebookId)?.localId;
  const focusScope = localId && resolveBareNotebook(localId) === selectedNotebookId ? remote ? sourceId : `local:${repoRoot}` : null;
  // A Notes page whose URL names no Focus shows the one it displayed last, decided while rendering so the list never paints first.
  const defaultFocus = notebookPreferences(selectedNotebookId).defaultFocusMode && !hasStoredFocusView(notebookRepository, focusScope, selectedNotebookId) ? CURRENT_FOCUS : null;
  const noteFocus = useNoteFocus({ page: focusPage, notebookId: selectedNotebookId, repository: notebookRepository, scope: focusScope, focusKey: activeTab === 'notes' ? route.focus : null, restoreLast: activeTab === 'notes' && !editorRoute.note, defaultFocus, writable: canWrite, flushEditors: editorRegistry.flushEditors });
  const focusDisplay = noteFocus.layout && noteFocus.entry ? displayedPanes(noteFocus.entry, noteFocus.layout, focusCapacity) : undefined;
  /** On phones the browse region and the Focus take turns filling the screen. */
  const [focusNarrowView, setFocusNarrowView] = useState<'focus' | 'browse'>('focus');
  const [addingToFocus, setAddingToFocus] = useState<{ tab: FocusTab; label: string; } | null>(null);
  // The rail shows the active pane's document panel when that pane displays a note.
  const panel = usePanelContext();
  const [documentContainer, setDocumentContainer] = useState<HTMLDivElement | null>(null);
  const activeKey = noteFocus.entry ? focusDisplay?.panes.find(pane => pane.panes.includes(noteFocus.entry!.activePane))?.key : undefined;
  // A compilation pane has no editor, so it has no document panel either.
  const activePaneNote = Boolean(activeKey?.startsWith('note:') && !isCompilationPath(activeKey.slice('note:'.length)));
  const focusDocumentPanel = {
    target: documentContainer,
    mode: panel.isOpen && isDocumentTool(panel.activeTool) ? panel.activeTool : null,
    onChange: (mode: NotePanelMode | null) => {
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
  return { focusCapacity, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, focusDocumentPanel, setDocumentContainer, showFocus };
}
