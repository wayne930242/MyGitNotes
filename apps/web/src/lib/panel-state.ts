import type { PanelToolId, WorkspaceToolId } from './panel-context.js';

export const PANEL_OPEN_STORAGE_KEY = 'github-notes:panel-open';
export const PANEL_TOOL_STORAGE_KEY = 'github-notes:panel-tool';

export const DEFAULT_PANEL_TOOL: WorkspaceToolId = 'todo';

export interface SavedPanelState {
  open: boolean;
  tool: PanelToolId;
}

export function getSavedPanelState(validToolIds: readonly PanelToolId[]): SavedPanelState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { open: false, tool: DEFAULT_PANEL_TOOL };
  }
  try {
    const rawTool = window.localStorage.getItem(PANEL_TOOL_STORAGE_KEY);
    const tool = validToolIds.includes(rawTool as PanelToolId) ? (rawTool as PanelToolId) : DEFAULT_PANEL_TOOL;
    const open = window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY) === 'true';
    return { open, tool };
  } catch {
    return { open: false, tool: DEFAULT_PANEL_TOOL };
  }
}

export function savePanelState(state: SavedPanelState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, String(state.open));
    window.localStorage.setItem(PANEL_TOOL_STORAGE_KEY, state.tool);
  } catch {
    // ignore quota / storage errors
  }
}
