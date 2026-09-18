import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeft } from 'lucide-react';
import { Group, Panel, Separator, usePanelRef, type PanelSize } from 'react-resizable-panels';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'mygitnotes:sidebar-width';
export const DEFAULT_SIDEBAR_WIDTH = 256;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 500;

export const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'mygitnotes:right-panel-width';
export const DEFAULT_RIGHT_PANEL_WIDTH = 320;
export const MIN_RIGHT_PANEL_WIDTH = 260;
export const MAX_RIGHT_PANEL_WIDTH = 480;
/** Width of the always-visible tool rail; must match `--right-panel-rail-width` in index.css. */
export const RIGHT_PANEL_RAIL_WIDTH = 49;

export function getSavedRightPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_RIGHT_PANEL_WIDTH;
  try {
    const saved = localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    if (!saved) return DEFAULT_RIGHT_PANEL_WIDTH;
    const parsed = parseInt(saved, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, parsed));
    }
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_RIGHT_PANEL_WIDTH;
}

export function saveRightPanelWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clamped = Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, Math.round(width)));
    localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(clamped));
  } catch {
    // Ignore storage access errors
  }
}

export function getSavedSidebarWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!saved) return DEFAULT_SIDEBAR_WIDTH;
    const parsed = parseInt(saved, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, parsed));
    }
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

export function saveSidebarWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
    document.documentElement.style.setProperty('--workspace-sidebar-width', `${clamped}px`);
  } catch {
    // Ignore storage access errors
  }
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 1101px)').matches;
  });

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1101px)');
    const update = () => setIsDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

interface SidebarContextValue {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  target: HTMLDivElement | null;
  setTarget: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useWorkspaceSidebarDrawer() {
  const context = useContext(SidebarContext);
  if (context) {
    return {
      open: context.open,
      setOpen: context.setOpen,
    };
  }
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

export function SidebarProvider({ children, open: controlledOpen, onOpenChange }: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen: React.Dispatch<React.SetStateAction<boolean>> = (value) => {
    const next = typeof value === 'function' ? (value as any)(open) : value;
    if (onOpenChange) onOpenChange(next);
    else setUncontrolledOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  return (
    <SidebarContext.Provider value={{ open, setOpen, target, setTarget }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function WorkspaceSidebarPortal({ children }: { children: React.ReactNode }) {
  const context = useContext(SidebarContext);
  const [domTarget, setDomTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!context?.target) {
      setDomTarget(document.getElementById('workspace-sidebar-slot'));
    }
  }, [context?.target]);

  const host = context?.target || domTarget;
  return host ? createPortal(children, host) : null;
}

export interface WorkspaceSplitLayoutProps {
  sidebar?: React.ReactNode;
  children: React.ReactNode;
  hasSidebar?: boolean;
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
  closeLabel?: string;
  className?: string;
  sidebarId?: string;
  sidebarDomId?: string;
  mainId?: string;
  mainClassName?: string;
  /** Rendered as a resizable panel on desktop, using the same splitter as the sidebar; falls back to its own CSS overlay/drawer positioning below the desktop breakpoint. */
  rightPanel?: React.ReactNode;
  rightPanelId?: string;
  /** Current desired width in pixels (rail-only, rail+content, or 0 to hide); reported by the right panel content itself. */
  rightPanelWidth?: number;
}

export function WorkspaceSplitLayout({
  sidebar,
  children,
  hasSidebar = true,
  drawerOpen: propDrawerOpen,
  onCloseDrawer: propOnCloseDrawer,
  closeLabel = 'Close sidebar',
  className = '',
  sidebarId = 'workspace-sidebar-panel',
  sidebarDomId,
  mainId = 'workspace-main-panel',
  mainClassName = '',
  rightPanel,
  rightPanelId = 'workspace-right-panel',
  rightPanelWidth,
}: WorkspaceSplitLayoutProps) {
  const isDesktop = useIsDesktop();
  const context = useContext(SidebarContext);
  const drawerOpen = propDrawerOpen !== undefined ? propDrawerOpen : (context?.open ?? false);
  const onCloseDrawer = propOnCloseDrawer || (() => context?.setOpen(false));

  const [initialWidth] = useState(getSavedSidebarWidth);
  const rightPanelRef = usePanelRef();

  useEffect(() => {
    document.documentElement.style.setProperty('--workspace-sidebar-width', `${initialWidth}px`);
  }, [initialWidth]);

  useLayoutEffect(() => {
    if (rightPanelWidth === undefined) return;
    rightPanelRef.current?.resize(rightPanelWidth);
  }, [rightPanelWidth]);

  const handleResize = (panelSize: PanelSize) => {
    if (panelSize?.inPixels) {
      const px = Math.round(panelSize.inPixels);
      if (px >= MIN_SIDEBAR_WIDTH && px <= MAX_SIDEBAR_WIDTH) {
        document.documentElement.style.setProperty('--workspace-sidebar-width', `${px}px`);
        saveSidebarWidth(px);
      }
    }
  };

  const rightPanelHidden = !rightPanelWidth;
  const rightPanelExpanded = !rightPanelHidden && rightPanelWidth! > RIGHT_PANEL_RAIL_WIDTH;

  const handleRightPanelResize = (panelSize: PanelSize) => {
    if (panelSize?.inPixels) {
      const contentPx = Math.round(panelSize.inPixels) - RIGHT_PANEL_RAIL_WIDTH;
      if (contentPx >= MIN_RIGHT_PANEL_WIDTH && contentPx <= MAX_RIGHT_PANEL_WIDTH) {
        saveRightPanelWidth(contentPx);
      }
    }
  };

  // The Panel stays mounted (gated on `rightPanel` alone, not `rightPanelWidth`) so RightPanel
  // never unmounts — it is the sole source of rightPanelWidth via onWidthChange, so if it were
  // unmounted while hidden it could never report a width again and the panel would stay hidden forever.
  const rightPanelNode = rightPanel ? (
    <React.Fragment key="right-panel">
      <Separator
        className={`workspace-splitter${rightPanelHidden ? ' workspace-splitter-hidden' : ''}`}
        disabled={!rightPanelExpanded}
      />
      <Panel
        id={rightPanelId}
        defaultSize={`${rightPanelWidth || RIGHT_PANEL_RAIL_WIDTH}px`}
        minSize={`${rightPanelHidden ? 0 : rightPanelExpanded ? RIGHT_PANEL_RAIL_WIDTH + MIN_RIGHT_PANEL_WIDTH : RIGHT_PANEL_RAIL_WIDTH}px`}
        maxSize={`${rightPanelHidden ? 0 : rightPanelExpanded ? RIGHT_PANEL_RAIL_WIDTH + MAX_RIGHT_PANEL_WIDTH : RIGHT_PANEL_RAIL_WIDTH}px`}
        groupResizeBehavior="preserve-pixel-size"
        onResize={handleRightPanelResize}
        panelRef={rightPanelRef}
        className="workspace-split-right-panel"
      >
        {rightPanel}
      </Panel>
    </React.Fragment>
  ) : null;

  const slotNode = hasSidebar ? (
    <div
      ref={context ? (node) => context.setTarget(node) : undefined}
      id={sidebarDomId || 'workspace-sidebar-slot'}
      className="workspace-sidebar-slot h-full flex flex-col min-w-0 min-h-0"
    >
      {sidebar}
    </div>
  ) : null;

  if (!isDesktop) {
    return (
      <div className={`workspace-split-layout flex-1 min-w-0 min-h-0 h-full flex overflow-hidden ${className}`}>
        {hasSidebar && (
          <WorkspaceSidebarDrawer
            open={drawerOpen}
            onClose={onCloseDrawer}
            closeLabel={closeLabel}
          >
            {slotNode}
          </WorkspaceSidebarDrawer>
        )}
        <div className={`workspace-split-main-panel flex-1 min-w-0 min-h-0 h-full ${mainClassName}`}>
          {children}
        </div>
        {rightPanel}
      </div>
    );
  }

  return (
    <div className={`workspace-split-layout flex-1 min-w-0 min-h-0 h-full flex overflow-hidden ${className}`}>
      <Group
        orientation="horizontal"
        className="workspace-split-group flex-1 min-w-0 min-h-0 h-full flex"
        onLayoutChanged={() => {
          const currentPx = parseInt(document.documentElement.style.getPropertyValue('--workspace-sidebar-width'), 10);
          if (Number.isFinite(currentPx) && currentPx >= MIN_SIDEBAR_WIDTH && currentPx <= MAX_SIDEBAR_WIDTH) {
            saveSidebarWidth(currentPx);
          }
        }}
      >
        {hasSidebar && (
          <>
            <Panel
              id={sidebarId}
              defaultSize={`${initialWidth}px`}
              minSize={`${MIN_SIDEBAR_WIDTH}px`}
              maxSize={`${MAX_SIDEBAR_WIDTH}px`}
              groupResizeBehavior="preserve-pixel-size"
              onResize={handleResize}
              className="workspace-split-sidebar-panel h-full"
            >
              <div className="workspace-split-sidebar-content h-full">
                {slotNode}
              </div>
            </Panel>
            <Separator className="workspace-splitter" />
          </>
        )}
        <Panel id={mainId} groupResizeBehavior="preserve-relative-size" className="flex-1 min-w-0 min-h-0 h-full">
          {rightPanelNode ? (
            <Group orientation="horizontal" className="workspace-split-inner-group flex-1 min-w-0 min-h-0 h-full flex">
              <Panel
                groupResizeBehavior="preserve-relative-size"
                className={`workspace-split-main-panel flex-1 min-w-0 min-h-0 h-full ${mainClassName}`}
              >
                {children}
              </Panel>
              {rightPanelNode}
            </Group>
          ) : (
            <div className={`workspace-split-main-panel flex-1 min-w-0 min-h-0 h-full ${mainClassName}`}>
              {children}
            </div>
          )}
        </Panel>
      </Group>
    </div>
  );
}

export function WorkspaceSidebarDrawer({ open, onClose, closeLabel, children }: {
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
}) {
  return <>
    {open && <button type="button" data-sidebar-backdrop="" className="notebook-backdrop mobile-only absolute inset-0 z-[56] bg-slate-950/40" aria-label={closeLabel} onClick={onClose} />}
    <div data-responsive-sidebar="" className={`workspace-responsive-sidebar ${open ? 'is-open' : ''}`}>{children}</div>
  </>;
}

export function WorkspaceSidebarToggle({ label, open, onClick, controlsId }: {
  label: string;
  controlsId?: string;
  open: boolean;
  onClick: () => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 767px)');
    const pick = () => setHost(document.getElementById(mobile.matches ? 'workspace-sidebar-toggle-slot-mobile' : 'workspace-sidebar-toggle-slot'));
    pick();
    mobile.addEventListener('change', pick);
    return () => mobile.removeEventListener('change', pick);
  }, []);
  return host && createPortal(<button type="button" data-sidebar-toggle="" className="ui-icon-button workspace-sidebar-toggle"
    aria-label={label} title={label} aria-expanded={open} aria-controls={controlsId} onClick={onClick}><PanelLeft size={17} /><span className="sr-only">{label}</span></button>, host);
}

/** One content origin and one scroll boundary for every workspace section. */
export function WorkspaceSidebar({ children, footer, label, className = '' }: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  label: string;
  className?: string;
}) {
  return <aside aria-label={label} className={`workspace-sidebar ${className}`}>
    <div className="workspace-sidebar-scroll">{children}</div>
    {footer && <div className="workspace-sidebar-footer">{footer}</div>}
  </aside>;
}

export function PageToolbar({ children }: {
  children: React.ReactNode;
}) {
  return <div className="workspace-page-header">
    <div className="workspace-page-actions">{children}</div>
  </div>;
}
