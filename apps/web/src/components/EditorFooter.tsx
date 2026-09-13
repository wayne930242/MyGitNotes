import { Check } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';

export function EditorFooter({ content, path, branch, state, status }: {
  content: string;
  path: string;
  branch?: string;
  state: 'loading' | 'saving' | 'pending' | 'saved';
  status: string;
}) {
  const { t } = useTranslation();
  const pending = state === 'saving' || state === 'pending';
  return (
    <div className="note-footer shrink-0 px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
      <div className="flex items-center gap-3">
        <span>{t('editor.words', { count: content.trim().split(/\s+/).filter(Boolean).length })}</span>
        <span className="text-slate-300 dark:text-slate-700">·</span>
        <span>{t('editor.characters', { count: content.length })}</span>
        <span className="text-slate-300 dark:text-slate-700">·</span>
        <span className="font-mono text-slate-400 dark:text-slate-500">{path}</span>
      </div>
      <div className="flex items-center gap-3">
        <span role="status" className={`flex items-center gap-1.5 font-medium ${pending ? 'text-amber-600 dark:text-amber-400' : state === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
          {pending ? <span className={`w-2 h-2 rounded-full bg-amber-500 ${state === 'saving' ? 'animate-pulse' : ''}`} /> : state === 'saved' ? <Check className="w-3.5 h-3.5" /> : null}
          {status}
        </span>
        {branch && <>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span className="font-mono text-slate-400 dark:text-slate-500">{t('editor.branch', { branch })}</span>
        </>}
      </div>
    </div>
  );
}
