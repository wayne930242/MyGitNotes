import { type ButtonHTMLAttributes, type ComponentPropsWithoutRef, forwardRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import './select-button.css';

/** Groups a primary action button with its dropdown chevron into one control. */
export const SelectButtonGroup: React.FC<{ className?: string; active?: boolean; children: React.ReactNode; }> = ({ className = '', active, children }) => <div className={['select-button', className].filter(Boolean).join(' ')} data-active={active || undefined}>{children}</div>;

// Both halves double up `ui-button` with their own class so the corner override always outranks
// `.ui-button`'s own border-radius, whichever of the two stylesheets the bundler happens to load last.
export const SelectButtonPrimary = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function SelectButtonPrimary({ className = '', type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} {...props} className={['ui-button', 'select-button-primary', className].filter(Boolean).join(' ')} />;
});

export const SelectButtonTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof DropdownMenu.Trigger>>(function SelectButtonTrigger({ className = '', ...props }, ref) {
  return <DropdownMenu.Trigger ref={ref} {...props} className={['ui-button', 'select-button-trigger', className].filter(Boolean).join(' ')} />;
});
