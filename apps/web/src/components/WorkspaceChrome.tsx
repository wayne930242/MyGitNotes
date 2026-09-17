import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeft } from 'lucide-react';
import { Group, Panel, Separator, type PanelSize } from 'react-resizable-panels';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'mygitnotes:sidebar-width';
export const DEFAULT_SIDEBAR_WIDTH = 256;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 500;

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
}: WorkspaceSplitLayoutProps) {
  const isDesktop = useIsDesktop();
  const context = useContext(SidebarContext);
  const drawerOpen = propDrawerOpen !== undefined ? propDrawerOpen : (context?.open ?? false);
  const onCloseDrawer = propOnCloseDrawer || (() => context?.setOpen(false));

  const [initialWidth] = useState(getSavedSidebarWidth);

  useEffect(() => {
    document.documentElement.style.setProperty('--workspace-sidebar-width', `${initialWidth}px`);
  }, [initialWidth]);

  const handleResize = (panelSize: PanelSize) => {
    if (panelSize?.inPixels) {
      const px = Math.round(panelSize.inPixels);
      if (px >= MIN_SIDEBAR_WIDTH && px <= MAX_SIDEBAR_WIDTH) {
        document.documentElement.style.setProperty('--workspace-sidebar-width', `${px}px`);
        saveSidebarWidth(px);
      }
    }
  };

  if (!hasSidebar) {
    return (
      <div className={`workspace-split-layout flex-1 min-w-0 min-h-0 h-full flex overflow-hidden ${className}`}>
        <div className={`workspace-split-main-panel flex-1 min-w-0 min-h-0 h-full ${mainClassName}`}>
          {children}
        </div>
      </div>
    );
  }

  const slotNode = (
    <div
      ref={context ? (node) => context.setTarget(node) : undefined}
      id={sidebarDomId || 'workspace-sidebar-slot'}
      className="workspace-sidebar-slot h-full flex flex-col min-w-0 min-h-0"
    >
      {sidebar}
    </div>
  );

  if (!isDesktop) {
    return (
      <div className={`workspace-split-layout flex-1 min-w-0 min-h-0 h-full flex overflow-hidden ${className}`}>
        <WorkspaceSidebarDrawer
          open={drawerOpen}
          onClose={onCloseDrawer}
          closeLabel={closeLabel}
        >
          {slotNode}
        </WorkspaceSidebarDrawer>
        <div className={`workspace-split-main-panel flex-1 min-w-0 min-h-0 h-full ${mainClassName}`}>
          {children}
        </div>
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
        <Panel
          id={mainId}
          groupResizeBehavior="preserve-relative-size"
          className={`workspace-split-main-panel flex-1 min-w-0 min-h-0 h-full ${mainClassName}`}
        >
          {children}
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
    {open && <button type="button" data-sidebar-backdrop="" className="notebook-backdrop mobile-only absolute inset-0 z-20 bg-slate-950/40" aria-label={closeLabel} onClick={onClose} />}
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
