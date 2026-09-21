import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, Check, Copy, Download, FileText, Printer } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { downloadTextFile, printNoteAsPdf } from '../lib/note-export.js';

interface Props {
  path: string;
  title: string;
  content: string;
  copyState: 'idle' | 'copied' | 'error';
  onCopy: () => void;
  /** Icon size in pixels for the compact frame's bar; the toolbar sizes its icons with CSS. */
  iconSize?: number;
  className: string;
}

/** The note editor's Export button: a menu of ways to take the note's content out of the editor. */
export function NoteExportMenu({ path, title, content, copyState, onCopy, iconSize, className }: Props) {
  const { t } = useTranslation();
  const label = t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.export');
  const Icon = copyState === 'copied' ? Check : copyState === 'error' ? AlertTriangle : Download;
  const filename = path.split('/').pop() || 'note.md';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={className} aria-label={label} title={label}>
        <Icon size={iconSize} aria-hidden='true' />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('editor.export')} onEscapeKeyDown={event => event.stopPropagation()}>
          <DropdownMenu.Item onSelect={onCopy}><Copy size={14} aria-hidden='true' /><span>{t('editor.exportCopy')}</span></DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => downloadTextFile(filename, content, 'text/markdown;charset=utf-8')}><FileText size={14} aria-hidden='true' /><span>{t('editor.exportMarkdown')}</span></DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => printNoteAsPdf(title || filename, content, path)}><Printer size={14} aria-hidden='true' /><span>{t('editor.exportPdf')}</span></DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
