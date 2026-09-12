import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export function EditorNotice({ children, actions, tone = 'warning' }: { children: ReactNode; actions?: ReactNode; tone?: 'warning' | 'error' }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`editor-notice ${tone === 'error' ? 'editor-notice-error' : ''}`}>
    <div className="editor-notice-message"><AlertCircle className="w-4 h-4 shrink-0" /><div className="min-w-0">{children}</div></div>
    {actions && <div className="editor-notice-actions">{actions}</div>}
  </div>;
}
