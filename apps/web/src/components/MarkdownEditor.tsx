import { Select } from './Select.js';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Code2, Eye } from 'lucide-react';
import type { LiveMarkdownHandle } from './LiveMarkdownEditor.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useWorkspaceLinks } from './WorkspaceLinks.js';
import { noteCandidates, noteCompletionAt } from '../lib/note-completion.js';
import { noteLinkHref, noteMarkdownLink } from '@mygitnotes/core/workspace-links';
import type { NoteItem } from '../lib/types.js';
import './note-completion.css';

const LiveMarkdownEditor = React.lazy(() => import('./LiveMarkdownEditor.js').then(module => ({ default: module.LiveMarkdownEditor })));
export type MarkdownEditorMode = 'live' | 'raw';
export interface MarkdownEditorHandle {
  insert: (text: string) => void;
  revealRange: (from: number, to: number, focus?: boolean) => void;
  goToLine: (line: number, options?: { focus?: boolean; smooth?: boolean }) => void;
  getCurrentLine: () => number;
}
interface Props {
  content: string;
  path: string;
  mode: MarkdownEditorMode;
  readOnly: boolean;
  onChange: (content: string) => void;
  ariaLabel?: string;
  onCaret?: (position: number) => void;
  compact?: boolean;
}

export function MarkdownEditorModeSwitch({ mode, onChange }: { mode: MarkdownEditorMode; onChange: (mode: MarkdownEditorMode) => void }) {
  const { t } = useTranslation();

  return (
    <div className="editor-mode-switch flex items-center bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-medium" role="group" aria-label="Editor mode">
      <Select
        className="editor-mode-select"
        aria-label="Editor mode"
        value={mode}
        onValueChange={value => onChange(value as MarkdownEditorMode)}
        options={[{ value: 'live', label: t('editor.live') }, { value: 'raw', label: t('editor.source') }]}
      />
      {([['live', t('editor.livePreview'), Eye], ['raw', t('editor.source'), Code2]] as const).map(([value, label, Icon]) => (
        <button
          className={`editor-mode-button flex items-center gap-1 px-3 py-1.5 rounded-md transition ${mode === value ? 'bg-white dark:bg-slate-900 shadow-sm hover:opacity-90' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
          key={value}
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
          style={mode === value ? { color: 'var(--color-primary)' } : undefined}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(({ content, path, mode, readOnly, onChange, onCaret, compact = false, ariaLabel = 'Document content' }, ref) => {
  const { t } = useTranslation();
  const { notes } = useWorkspaceLinks();
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [choice, setChoice] = useState(0);
  const [picker, setPicker] = useState(false), [query, setQuery] = useState('');
  const live = useRef<LiveMarkdownHandle>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const sourceLineNumbers = useRef<HTMLDivElement>(null);
  const [activeSourceLine, setActiveSourceLine] = useState(1);
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const sourceLineCount = content.split('\n').length;

  useEffect(() => setActiveSourceLine(1), [path, mode]);
  const updateActiveSourceLine = (target: HTMLTextAreaElement) => {
    setActiveSourceLine(target.value.slice(0, target.selectionStart).split('\n').length);
    setCaret(target.selectionStart); onCaret?.(target.selectionStart);
  };
  const match = !readOnly && mode === 'raw' && !dismissed && caret !== null ? noteCompletionAt(content, caret) : null;
  const suggestions = match ? noteCandidates(notes, match.query, path) : [];
  const accept = (note: NoteItem) => {
    if (!match) return;
    const insert = noteLinkHref(path, note.path) + (content[match.to] === ')' ? '' : ')');
    onChange(content.slice(0, match.from) + insert + content.slice(match.to)); setDismissed(true);
    requestAnimationFrame(() => { const pos = match.from + insert.length; source.current?.focus(); source.current?.setSelectionRange(pos, pos); });
  };
  const insertPicked = (note: NoteItem) => {
    const text = noteMarkdownLink(path, note.path, note.title);
    if (mode === 'live') live.current?.insert(text);
    else { const position = source.current?.selectionStart ?? content.length; onChange(content.slice(0, position) + text + content.slice(position)); }
    setPicker(false);
  };

  useImperativeHandle(ref, () => ({
    insert(text) {
      if (readOnly) return;
      if (mode === 'live' && isMarkdown) { live.current?.insert(text); return; }
      const start = source.current?.selectionStart ?? content.length;
      const end = source.current?.selectionEnd ?? content.length;
      onChange(content.slice(0, start) + text + content.slice(end));
      requestAnimationFrame(() => { source.current?.focus(); source.current?.setSelectionRange(start + text.length, start + text.length); });
    },
    revealRange(from, to, focus = false) {
      if (mode === 'live' && isMarkdown) { live.current?.revealRange(from, to, focus); return; }
      const target = source.current; if (!target) return;
      const start = Math.max(0, Math.min(from, target.value.length));
      const end = Math.max(start, Math.min(to, target.value.length));
      target.setSelectionRange(start, end);
      const line = target.value.slice(0, start).split('\n').length;
      setActiveSourceLine(line);
      target.scrollTop = Math.max(0, (line - 1) * 22.75 - target.clientHeight / 2);
      if (focus) target.focus();
    },
    goToLine(line, options = {}) {
      if (mode === 'live' && isMarkdown) { live.current?.goToLine(line, options); return; }
      const target = source.current; if (!target) return;
      const targetLine = Math.max(1, Math.min(line, target.value.split('\n').length));
      let from = 0;
      for (let currentLine = 1; currentLine < targetLine; currentLine += 1) from = target.value.indexOf('\n', from) + 1;
      target.setSelectionRange(from, from); setActiveSourceLine(targetLine);
      target.scrollTo({ top: Math.max(0, (targetLine - 1) * 22.75 - 16), behavior: options.smooth ? 'smooth' : 'auto' });
      if (options.focus !== false) target.focus();
    },
    getCurrentLine() {
      if (mode === 'live' && isMarkdown) return live.current?.getCurrentLine() ?? 1;
      const target = source.current;
      if (!target) return 1;
      const lineCount = target.value.split('\n').length;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 2) return lineCount;
      const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight) || 22.75;
      return Math.max(1, Math.min(Math.floor(target.scrollTop / lineHeight) + 1, lineCount));
    },
  }), [content, mode, readOnly, isMarkdown, onChange]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden" data-markdown-editor>
      {isMarkdown && !readOnly && !compact && <div className="markdown-insert-toolbar">
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setPicker(value => !value); setQuery(''); }}>{t('graph.insertLink')}</button>
        <button type="button" onClick={() => {
          const text = `\n\n| ${t('table.column')} 1 | ${t('table.column')} 2 |\n| --- | --- |\n|  |  |\n\n`;
          if (mode === 'live') live.current?.insert(text);
          else {
            const position = source.current?.selectionStart ?? content.length;
            onChange(content.slice(0, position) + text + content.slice(position));
          }
        }}>{t('table.insert')}</button>
      </div>}
      {picker && <div className="note-link-picker"><input autoFocus type="search" aria-label={t('graph.findNote')} placeholder={t('graph.findNote')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setPicker(false); }} />
        {noteCandidates(notes, query, path).map(note => <button type="button" key={note.path} onClick={() => insertPicked(note)}>{note.title}<small>{note.notebookId} · {note.path}</small></button>)}
      </div>}
      {mode === 'live' && isMarkdown ? (
        <React.Suspense fallback={<p className="p-6 text-sm text-slate-400">{t('editor.loadingEditor')}</p>}>
          <LiveMarkdownEditor key={path} ref={live} content={content} notePath={path} readOnly={readOnly} onChange={onChange} onCaret={onCaret} noteOptions={notes} ariaLabel={ariaLabel} />
        </React.Suspense>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
          {!compact && <div className="px-3 py-1 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between gap-4">
            <span>{isMarkdown ? t('editor.rawSource') : t('editor.plainTextSource')}</span>
            <span className="font-mono truncate">{path}</span>
          </div>}
          <div key={path} className="relative flex-1 flex min-h-0 overflow-hidden">
            {suggestions.length > 0 && <div role="listbox" aria-label={t('graph.findNote')} className="note-source-completions">
              {suggestions.map((note, index) => <button type="button" role="option" aria-selected={index === choice % suggestions.length} key={note.path} onMouseDown={event => event.preventDefault()} onClick={() => accept(note)}>{note.title}<small>{note.notebookId} · {note.path}</small></button>)}
            </div>}
            <div
              data-source-line-numbers
              aria-hidden="true"
              className="w-12 shrink-0 overflow-hidden border-r border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 text-slate-400/70 dark:text-slate-500/70"
            >
              <div ref={sourceLineNumbers} className="py-4 pr-3 text-right font-mono text-xs tabular-nums" style={{ lineHeight: '1.421875rem' }}>
                {Array.from({ length: sourceLineCount }, (_, index) => {
                  const line = index + 1;
                  return (
                    <div
                      key={index}
                      data-line-number
                      data-active-line={line === activeSourceLine ? 'true' : undefined}
                      className={`origin-right transition-[color,opacity,transform,font-weight] duration-150 ${line === activeSourceLine ? 'scale-[1.08] font-semibold text-slate-600 dark:text-slate-300' : ''}`}
                    >
                      {line}
                    </div>
                  );
                })}
              </div>
            </div>
            <textarea
              ref={source}
              readOnly={readOnly}
              aria-label={ariaLabel}
              value={content}
              onChange={event => { setDismissed(false); setChoice(0); updateActiveSourceLine(event.currentTarget); onChange(event.target.value); }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || !suggestions.length) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setChoice(value => (value + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); }
                if (event.key === 'Enter') { event.preventDefault(); accept(suggestions[choice % suggestions.length]); }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); }
              }}
              onFocus={event => updateActiveSourceLine(event.currentTarget)}
              onSelect={event => updateActiveSourceLine(event.currentTarget)}
              onScroll={event => {
                if (sourceLineNumbers.current) sourceLineNumbers.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
              }}
              wrap="off"
              className="flex-1 min-w-0 min-h-0 px-4 py-4 font-mono text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 resize-none focus:outline-none"
              style={{ lineHeight: '1.421875rem' }}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
});
