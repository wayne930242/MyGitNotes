import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSavedPanelState, savePanelState } from './panel-state.js';

export type WorkspaceToolId = 'calendar' | 'todo' | 'changes';
export const WORKSPACE_TOOL_IDS: readonly WorkspaceToolId[] = ['calendar', 'todo', 'changes'];

/**
 * Tracks the workspace-level tool panel (Calendar/Todo). It hides itself
 * while a note is open — the editor owns its own document panel (find,
 * outline, frontmatter, assets, git) rather than sharing this one.
 */
interface PanelContextValue {
  isOpen: boolean;
  activeTool: WorkspaceToolId;
  hasOpenNote: boolean;
  openTool: (id: WorkspaceToolId) => void;
  close: () => void;
  setHasOpenNote: (open: boolean) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanelContext(): PanelContextValue {
  const context = useContext(PanelContext);
  if (!context) throw new Error('usePanelContext must be used within a PanelProvider');
  return context;
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const saved = useMemo(() => getSavedPanelState(WORKSPACE_TOOL_IDS), []);
  const [isOpen, setIsOpen] = useState(saved.open);
  const [activeTool, setActiveTool] = useState<WorkspaceToolId>(saved.tool);
  const [hasOpenNote, setHasOpenNote] = useState(false);

  useEffect(() => savePanelState({ open: isOpen, tool: activeTool }), [isOpen, activeTool]);

  const openTool = (id: WorkspaceToolId) => {
    if (isOpen && activeTool === id) { setIsOpen(false); return; }
    setActiveTool(id);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  const value: PanelContextValue = { isOpen, activeTool, hasOpenNote, openTool, close, setHasOpenNote };
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
