import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { BookContents, type BookContentsProps } from './BookContents.js';
import { Button } from './Button.js';

const FOCUSABLE = 'button:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';

export interface BookDrawerProps extends Omit<BookContentsProps, 'onJump'> {
  /** The element the drawer opens over: the book itself, so it covers the book and not the page. */
  container: HTMLElement;
  /** Choosing an entry closes the drawer for the jump, which then moves focus itself. */
  onJump: (anchor: string) => void;
  /** Closes the drawer and returns focus to the button that opened it. */
  onClose: () => void;
}

/** The contents list over a narrow book: a dialog with its own close button; Escape, that button or a click outside closes it. */
export function BookDrawer({ container, onClose, ...contents }: BookDrawerProps) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  /* eslint-disable react/refs -- Keep the current callback in a ref for an imperative listener without recreating its subscription. */
  close.current = onClose;
  /* eslint-enable react/refs */
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('.compilation-book-drawer-close')?.focus();
    // Capture phase, so the drawer takes this Escape before the compilation behind it can.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
  // Tab stays inside the drawer while it is open.
  const trap = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div className='compilation-book-drawer' onKeyDown={trap}>
      <div className='compilation-book-drawer-backdrop' data-testid='book-drawer-backdrop' onClick={onClose} />
      <div ref={panel} role='dialog' aria-modal='true' aria-label={t('book.contents')} className='compilation-book-drawer-panel'>
        <Button type='button' size='icon' className='compilation-book-drawer-close' aria-label={t('book.closeContents')} title={t('book.closeContents')} onClick={onClose}>
          <X size={16} aria-hidden='true' />
        </Button>
        <BookContents {...contents} />
      </div>
    </div>,
    container,
  );
}
