import type { ReactNode } from 'react';

export function GraphTool({ label, children, onClick, pressed, disabled }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean; }) {
  return <button type='button' className='ui-button graph-tool' aria-label={label} title={label} data-tooltip={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}
