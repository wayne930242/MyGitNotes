import { forwardRef, type ButtonHTMLAttributes } from 'react';
import '../ui-buttons.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger';
  size?: 'default' | 'icon';
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant = 'default', size = 'default', type = 'button', className = '', ...props }, ref) {
  return <button ref={ref} type={type} {...props} className={[
    size === 'icon' ? 'ui-icon-button' : 'ui-button',
    variant === 'default' ? '' : `ui-button-${variant}`,
    className,
  ].filter(Boolean).join(' ')} />;
});
