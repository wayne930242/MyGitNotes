import React from 'react';

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

export function PageHeader({ title, description, children }: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return <div className="workspace-page-header">
    <div className="workspace-page-heading">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
    {children && <div className="workspace-page-actions">{children}</div>}
  </div>;
}
