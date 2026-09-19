import { Check } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';

export function EditorFooter({ content, path, branch, state, status }: { content: string; path: string; branch?: string; state: 'loading' | 'saving' | 'pending' | 'saved'; status: string; }) {
  const { t } = useTranslation();
  const pending = state === 'saving' || state === 'pending';
  return (
    <div className='note-footer shrink-0 px-5 py-3 border-t border-line bg-sidebar/80 flex items-center justify-between gap-4 text-xs text-muted'>
      <div className='flex items-center gap-3'>
        <span>{t('editor.words', { count: content.trim().split(/\s+/).filter(Boolean).length })}</span>
        <span className='text-muted'>·</span>
        <span>{t('editor.characters', { count: content.length })}</span>
        <span className='text-muted'>·</span>
        <span className='font-mono text-muted'>{path}</span>
      </div>
      <div className='flex items-center gap-3'>
        <span role='status' className={`flex items-center gap-1.5 font-medium ${pending ? 'text-warning' : state === 'saved' ? 'text-success' : ''}`}>{pending ? <span className={`w-2 h-2 rounded-full bg-warning ${state === 'saving' ? 'animate-pulse' : ''}`} /> : state === 'saved' ? <Check className='w-3.5 h-3.5' /> : null}{status}</span>
        {branch && (
          <>
            <span className='text-muted'>|</span>
            <span className='font-mono text-muted'>{t('editor.branch', { branch })}</span>
          </>
        )}
      </div>
    </div>
  );
}
