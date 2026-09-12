import { Select } from './Select.js';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Code2, Eye } from 'lucide-react';
import type { LiveMarkdownHandle } from './LiveMarkdownEditor.js';

const LiveMarkdownEditor = React.lazy(() => import('./LiveMarkdownEditor.js').then(module => ({ default: module.LiveMarkdownEditor })));
export type MarkdownEditorMode = 'live' | 'raw';
export interface MarkdownEditorHandle { insert: (text: string) => void }
interface Props {
  content: string;
  path: string;
  mode: MarkdownEditorMode;
  readOnly: boolean;
  onChange: (content: string) => void;
  ariaLabel?: string;
}
export function MarkdownEditorModeSwitch({ mode, onChange }: { mode: MarkdownEditorMode; onChange: (mode: MarkdownEditorMode) => void }) {
  return <div className="editor-mode-switch flex items-center bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-medium" role="group" aria-label="Editor mode">
    <Select className="editor-mode-select" aria-label="Editor mode" value={mode} onValueChange={value => onChange(value as MarkdownEditorMode)} options={[{value:'live',label:'Live'},{value:'raw',label:'Source'}]} />
    {([['live', 'Live Preview', Eye], ['raw', 'Source', Code2]] as const).map(([value, label, Icon]) => <button className={`editor-mode-button flex items-center gap-1 px-3 py-1.5 rounded-md ${mode === value ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500'}`} key={value} aria-pressed={mode === value} onClick={() => onChange(value)} style={mode === value ? { color: 'var(--color-primary)' } : undefined}><Icon className="w-3.5 h-3.5" />{label}</button>)}
  </div>;
}
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(({ content, path, mode, readOnly, onChange, ariaLabel = 'Document content' }, ref) => {
  const live = useRef<LiveMarkdownHandle>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  useImperativeHandle(ref, () => ({ insert(text) {
    if (readOnly) return;
    if (mode === 'live' && isMarkdown) { live.current?.insert(text); return; }
    const start = source.current?.selectionStart ?? content.length;
    const end = source.current?.selectionEnd ?? content.length;
    onChange(content.slice(0,start) + text + content.slice(end));
    requestAnimationFrame(() => { source.current?.focus(); source.current?.setSelectionRange(start+text.length,start+text.length); });
  } }), [content, mode, readOnly, isMarkdown, onChange]);
  return <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden" data-markdown-editor>
    {mode === 'live' && isMarkdown ? <React.Suspense fallback={<p className="p-6 text-sm text-slate-400">Loading editor…</p>}>
      <LiveMarkdownEditor key={path} ref={live} content={content} notePath={path} readOnly={readOnly} onChange={onChange} ariaLabel={ariaLabel} />
    </React.Suspense> : <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
      <div className="px-3 py-1 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between gap-4">
        <span>{isMarkdown ? 'Markdown Raw Source' : 'Plain-Text / Source Editor'}</span><span className="font-mono truncate">{path}</span>
      </div>
      <textarea key={path} ref={source} readOnly={readOnly} aria-label={ariaLabel} value={content} onChange={event => onChange(event.target.value)} className="flex-1 min-h-0 p-4 font-mono text-sm leading-relaxed text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 resize-none focus:outline-none" spellCheck={false} />
    </div>}
  </div>;
});
