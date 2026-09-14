import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeft } from 'lucide-react';

export function useWorkspaceSidebarDrawer() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return { open, setOpen };
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
  useEffect(() => { setHost(document.getElementById('workspace-sidebar-toggle-slot')); }, []);
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
