import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { X } from 'lucide-react';

export function WorkspaceDialog({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string; }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  /* eslint-disable react/refs -- Keep the current callback in a ref for an imperative listener without recreating its subscription. */
  close.current = onClose;
  /* eslint-enable react/refs */
  /* eslint-disable react-hooks/exhaustive-deps -- Cleanup intentionally reads the latest cancellation or resource ref, including work started after mounting. */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className={`workspace-dialog ui-dialog ${className}`}
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }}
    >
      <div className='workspace-dialog-heading'>
        <h2>{title}</h2>
        <button type='button' className='ui-icon-button' aria-label={t('common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
