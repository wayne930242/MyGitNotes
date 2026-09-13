import React, { useEffect, useState } from 'react';
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

export function WorkspaceSidebarToggle({ label, open, onClick }: {
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return <button type="button" data-sidebar-toggle="" className="workspace-sidebar-toggle ui-button mobile-only"
    aria-label={label} aria-expanded={open} onClick={onClick}><PanelLeft size={16} /><span>{label}</span></button>;
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
