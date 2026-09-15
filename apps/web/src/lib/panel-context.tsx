import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PANEL_TOOL, getSavedPanelState, savePanelState } from './panel-state.js';

export type NoteToolId = 'find' | 'outline' | 'frontmatter' | 'assets' | 'git';
export type WorkspaceToolId = 'calendar' | 'todo';
export type PanelToolId = NoteToolId | WorkspaceToolId;

export const NOTE_TOOL_IDS: readonly NoteToolId[] = ['find', 'outline', 'frontmatter', 'assets', 'git'];
export const WORKSPACE_TOOL_IDS: readonly WorkspaceToolId[] = ['calendar', 'todo'];
const ALL_TOOL_IDS: readonly PanelToolId[] = [...WORKSPACE_TOOL_IDS, ...NOTE_TOOL_IDS];

export function isNoteToolId(id: PanelToolId): id is NoteToolId {
  return (NOTE_TOOL_IDS as readonly string[]).includes(id);
}

interface PanelContextValue {
  isOpen: boolean;
  activeTool: PanelToolId;
  hasOpenNote: boolean;
  isMarkdownNote: boolean;
  noteToolPortalTarget: HTMLDivElement | null;
  registerNoteToolPortal: (node: HTMLDivElement | null) => void;
  openTool: (id: PanelToolId) => void;
  close: () => void;
  setNoteContext: (open: boolean, isMarkdown: boolean) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanelContext(): PanelContextValue {
  const context = useContext(PanelContext);
  if (!context) throw new Error('usePanelContext must be used within a PanelProvider');
  return context;
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const saved = useMemo(() => getSavedPanelState(ALL_TOOL_IDS), []);
  const [isOpen, setIsOpen] = useState(saved.open);
  const [activeTool, setActiveTool] = useState<PanelToolId>(saved.tool);
  const [hasOpenNote, setHasOpenNote] = useState(false);
  const [isMarkdownNote, setIsMarkdownNote] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const lastWorkspaceTool = useRef<WorkspaceToolId>(isNoteToolId(saved.tool) ? DEFAULT_PANEL_TOOL : (saved.tool as WorkspaceToolId));

  useEffect(() => savePanelState({ open: isOpen, tool: activeTool }), [isOpen, activeTool]);

  const openTool = (id: PanelToolId) => {
    if (!isNoteToolId(id)) lastWorkspaceTool.current = id;
    setActiveTool(id);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);
  const setNoteContext = (open: boolean, isMarkdown: boolean) => {
    setHasOpenNote(open);
    setIsMarkdownNote(isMarkdown);
    if (!open) setActiveTool(current => (isNoteToolId(current) ? lastWorkspaceTool.current : current));
  };

  const value: PanelContextValue = {
    isOpen, activeTool, hasOpenNote, isMarkdownNote, noteToolPortalTarget: portalTarget,
    registerNoteToolPortal: setPortalTarget, openTool, close, setNoteContext,
  };
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
