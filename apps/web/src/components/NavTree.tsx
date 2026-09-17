import React, { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';

export interface NavTreeProps {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function NavTree({ children, className = '', 'aria-label': ariaLabel }: NavTreeProps) {
  return (
    <nav className={`nav-tree ${className}`} aria-label={ariaLabel}>
      {children}
    </nav>
  );
}

export interface NavTreeRowProps {
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (e: React.MouseEvent) => void;
  expandAriaLabel?: string;
  icon?: ReactNode;
  title: string;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  actions?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
  entryClassName?: string;
  disabled?: boolean;
  buttonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}

export function NavTreeRow({
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  expandAriaLabel,
  icon = <Folder size={15} />,
  title,
  selected = false,
  onSelect,
  actions,
  prefix,
  suffix,
  className = '',
  entryClassName = '',
  disabled = false,
  buttonProps,
}: NavTreeRowProps) {
  return (
    <div className={`nav-tree-row ${selected ? 'is-selected' : ''} ${className}`}>
      {prefix}
      {hasChildren ? (
        <button
          type="button"
          className="nav-tree-chevron"
          disabled={disabled}
          aria-label={expandAriaLabel || (isExpanded ? 'Collapse' : 'Expand')}
          aria-expanded={isExpanded}
          onClick={e => {
            e.stopPropagation();
            onToggleExpand?.(e);
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span className="nav-tree-chevron-spacer" aria-hidden="true" />
      )}
      <button
        type="button"
        className={`nav-tree-entry ${entryClassName}`}
        aria-current={selected ? 'location' : undefined}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
        title={title}
        {...buttonProps}
      >
        {icon}
        <span className="nav-tree-title">{title}</span>
        {suffix}
      </button>
      {actions}
    </div>
  );
}

export function NavTreeChildren({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`nav-tree-children ${className}`}>{children}</div>;
}
