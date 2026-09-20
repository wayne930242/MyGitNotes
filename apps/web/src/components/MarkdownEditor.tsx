import { Select } from './Select.js';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Code2, Eye, Link2, Plus, Square, Table2 } from 'lucide-react';
import type { LiveMarkdownHandle } from './LiveMarkdownEditor.js';
import { type TranslationKey, useTranslation } from '../lib/i18n/index.js';
import { noteCompletionAt, useNoteCandidates } from '../lib/note-completion.js';
import { noteLinkHref, noteMarkdownLink } from '@mygitnotes/core/workspace-links';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { DIRECTIVE_TEMPLATES } from '../lib/directives.js';
import './note-completion.css';
import { copyLinePrompt } from '../lib/line-prompt-copy.js';

const LiveMarkdownEditor = React.lazy(() => import('./LiveMarkdownEditor.js').then(module => ({ default: module.LiveMarkdownEditor })));
export type MarkdownEditorMode = 'live' | 'raw';
export interface MarkdownEditorHandle {
  /** Inserts `text` at `at`, or in place of the selection. */
  insert: (text: string, at?: number) => void;
  revealRange: (from: number, to: number, focus?: boolean) => void;
  goToLine: (line: number, options?: { focus?: boolean; smooth?: boolean; }) => void;
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
  /** A toolbar element that hosts the insert actions; without one they sit in a row above the content. */
  insertSlot?: HTMLElement | null;
  showLineNumbers?: boolean;
  lineNumberOffset?: number;
}

export function MarkdownEditorModeSwitch({ mode, onChange }: { mode: MarkdownEditorMode; onChange: (mode: MarkdownEditorMode) => void; }) {
  const { t } = useTranslation();

  return (
    <div className='editor-mode-switch flex items-center bg-line/70 p-0.5 rounded-lg text-xs font-medium' role='group' aria-label='Editor mode'>
      <Select className='editor-mode-select' aria-label='Editor mode' value={mode} onValueChange={value => onChange(value as MarkdownEditorMode)} options={[{ value: 'live', label: t('editor.live') }, { value: 'raw', label: t('editor.source') }]} />
      {([['live', t('editor.livePreview'), Eye], ['raw', t('editor.source'), Code2]] as const).map(([value, label, Icon]) => (
        <button className={`editor-mode-button flex items-center gap-1 px-3 py-1.5 rounded-md transition ${mode === value ? 'bg-surface shadow-sm hover:opacity-90' : 'text-muted hover:text-fg hover:bg-fg/5'}`} key={value} aria-pressed={mode === value} onClick={() => onChange(value)} style={mode === value ? { color: 'var(--color-primary)' } : undefined}>
          <Icon className='w-3.5 h-3.5' />
          {label}
        </button>
      ))}
    </div>
  );
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(({ content, path, mode, readOnly, onChange, onCaret, compact = false, insertSlot, ariaLabel = 'Document content', showLineNumbers = true, lineNumberOffset = 0 }, ref) => {
  const { t } = useTranslation();
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [choice, setChoice] = useState(0);
  const [picker, setPicker] = useState(false), [query, setQuery] = useState('');
  // A chosen block keeps the editor's focus instead of returning it to the menu trigger.
  const directiveInserted = useRef(false);

  const live = useRef<LiveMarkdownHandle>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const sourceLineNumbers = useRef<HTMLDivElement>(null);
  const [activeSourceLine, setActiveSourceLine] = useState(1);
  const [draggedSourceRange, setDraggedSourceRange] = useState<[number, number] | null>(null);
  const sourceDragStart = useRef<number | null>(null);
  const lastSourceGutterClick = useRef<{ line: number; at: number; } | null>(null);
  const lastSourceGutterCopy = useRef<{ line: number; at: number; } | null>(null);
  const [lineCopyFeedback, setLineCopyFeedback] = useState<{ ok: boolean; start: number; end: number; } | null>(null);
  const lineCopyTimer = useRef<ReturnType<typeof setTimeout>>();
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(path);
  const sourceLineCount = content.split('\n').length;

  const copyLines = async (firstBodyLine: number, lastBodyLine = firstBodyLine) => {
    const firstBody = Math.min(firstBodyLine, lastBodyLine), lastBody = Math.max(firstBodyLine, lastBodyLine);
    const start = firstBody + lineNumberOffset, end = lastBody + lineNumberOffset;
    const ok = await copyLinePrompt(path, start, end, content.split('\n').slice(firstBody - 1, lastBody).join('\n'));
    setLineCopyFeedback({ ok, start, end });
    clearTimeout(lineCopyTimer.current);
    lineCopyTimer.current = setTimeout(() => setLineCopyFeedback(null), 2000);
  };
  useEffect(() => () => clearTimeout(lineCopyTimer.current), []);

  const [sourceIdentity, setSourceIdentity] = useState({ path, mode });
  if (sourceIdentity.path !== path || sourceIdentity.mode !== mode) {
    setSourceIdentity({ path, mode });
    setActiveSourceLine(1);
  }
  const updateActiveSourceLine = (target: HTMLTextAreaElement) => {
    setActiveSourceLine(target.value.slice(0, target.selectionStart).split('\n').length);
    setCaret(target.selectionStart);
    onCaret?.(target.selectionStart);
  };
  const match = !readOnly && mode === 'raw' && !dismissed && caret !== null ? noteCompletionAt(content, caret) : null;
  const suggestions = useNoteCandidates(match ? match.query : null, path);
  const pickerCandidates = useNoteCandidates(picker ? query : null, path);
  const accept = (note: NoteListItem) => {
    if (!match) return;
    const insert = noteLinkHref(path, note.path) + (content[match.to] === ')' ? '' : ')');
    onChange(content.slice(0, match.from) + insert + content.slice(match.to));
    setDismissed(true);
    requestAnimationFrame(() => {
      const pos = match.from + insert.length;
      source.current?.focus();
      source.current?.setSelectionRange(pos, pos);
    });
  };
  const insertPicked = (note: NoteListItem) => {
    const text = noteMarkdownLink(path, note.path, note.title);
    if (mode === 'live') live.current?.insert(text);
    else {
      const position = source.current?.selectionStart ?? content.length;
      onChange(content.slice(0, position) + text + content.slice(position));
    }
    setPicker(false);
  };

  const insertDirective = (type = 'info') => {
    const tpl = DIRECTIVE_TEMPLATES.find(t => t.type === type) ?? DIRECTIVE_TEMPLATES[0];
    const text = `\n\n${tpl.defaultSnippet}\n`;
    if (mode === 'live') live.current?.insert(text);
    else {
      const position = source.current?.selectionStart ?? content.length;
      onChange(content.slice(0, position) + text + content.slice(position));
    }
  };

  const insertTable = () => {
    const text = `\n\n| ${t('table.column')} 1 | ${t('table.column')} 2 |\n| --- | --- |\n|  |  |\n\n`;
    if (mode === 'live') live.current?.insert(text);
    else {
      const position = source.current?.selectionStart ?? content.length;
      onChange(content.slice(0, position) + text + content.slice(position));
    }
  };
  const insertActions = isMarkdown && !readOnly && !compact
    ? (
      <>
        <button
          type='button'
          className='ui-icon-button toolbar-icon-button insert-icon-button'
          aria-label={t('graph.insertLink')}
          title={t('graph.insertLink')}
          aria-expanded={picker}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            setPicker(value => !value);
            setQuery('');
          }}
        >
          <Link2 aria-hidden='true' />
          <span className='insert-plus-badge' aria-hidden='true'>
            <Plus />
          </span>
        </button>
        <button type='button' className='ui-icon-button toolbar-icon-button insert-icon-button' aria-label={t('table.insert')} title={t('table.insert')} onClick={insertTable}>
          <Table2 aria-hidden='true' />
          <span className='insert-plus-badge' aria-hidden='true'>
            <Plus />
          </span>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className='ui-icon-button toolbar-icon-button insert-icon-button' aria-label={t('directive.insert')} title={t('directive.insert')}>
            <Square aria-hidden='true' />
            <span className='insert-plus-badge' aria-hidden='true'>
              <Plus />
            </span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className='markdown-insert-menu'
              align='end'
              sideOffset={4}
              collisionPadding={8}
              aria-label={t('directive.selectFormat')}
              onEscapeKeyDown={event => event.stopPropagation()}
              onCloseAutoFocus={event => {
                if (directiveInserted.current) event.preventDefault();
                directiveInserted.current = false;
              }}
            >
              {DIRECTIVE_TEMPLATES.map(tpl => (
                <DropdownMenu.Item
                  key={tpl.type}
                  onSelect={() => {
                    directiveInserted.current = true;
                    insertDirective(tpl.type);
                  }}
                >
                  {t(`directive.${tpl.type}` as TranslationKey)}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </>
    )
    : null;

  useImperativeHandle(ref, () => ({
    insert(text, at) {
      if (readOnly) return;
      if (mode === 'live' && isMarkdown) {
        live.current?.insert(text, at);
        return;
      }
      const start = at ?? source.current?.selectionStart ?? content.length;
      const end = at ?? source.current?.selectionEnd ?? content.length;
      onChange(content.slice(0, start) + text + content.slice(end));
      requestAnimationFrame(() => {
        source.current?.focus();
        source.current?.setSelectionRange(start + text.length, start + text.length);
      });
    },
    revealRange(from, to, focus = false) {
      if (mode === 'live' && isMarkdown) {
        live.current?.revealRange(from, to, focus);
        return;
      }
      const target = source.current;
      if (!target) return;
      const start = Math.max(0, Math.min(from, target.value.length));
      const end = Math.max(start, Math.min(to, target.value.length));
      target.setSelectionRange(start, end);
      const line = target.value.slice(0, start).split('\n').length;
      setActiveSourceLine(line);
      target.scrollTop = Math.max(0, (line - 1) * 22.75 - target.clientHeight / 2);
      if (focus) target.focus();
    },
    goToLine(line, options = {}) {
      if (mode === 'live' && isMarkdown) {
        live.current?.goToLine(line, options);
        return;
      }
      const target = source.current;
      if (!target) return;
      const targetLine = Math.max(1, Math.min(line, target.value.split('\n').length));
      let from = 0;
      for (let currentLine = 1; currentLine < targetLine; currentLine += 1) from = target.value.indexOf('\n', from) + 1;
      target.setSelectionRange(from, from);
      setActiveSourceLine(targetLine);
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
    <div className='relative flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden' data-markdown-editor>
      {insertActions && (insertSlot ? createPortal(insertActions, insertSlot) : <div className='markdown-insert-toolbar'>{insertActions}</div>)}
      {picker && (
        <div className='note-link-picker'>
          <input
            autoFocus
            type='search'
            aria-label={t('graph.findNote')}
            placeholder={t('graph.findNote')}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') setPicker(false);
            }}
          />
          {pickerCandidates.map(note => (
            <button
              type='button'
              key={note.path}
              onClick={() => insertPicked(note)}
            >
              {note.title}
              <small>{note.notebookId}{' · '}{note.path}</small>
            </button>
          ))}
        </div>
      )}
      {mode === 'live' && isMarkdown
        ? (
          <React.Suspense fallback={<p className='p-6 text-sm text-muted'>{t('editor.loadingEditor')}</p>}>
            <LiveMarkdownEditor key={path} ref={live} content={content} notePath={path} readOnly={readOnly} onChange={onChange} onCaret={onCaret} ariaLabel={ariaLabel} showLineNumbers={showLineNumbers} lineNumberOffset={lineNumberOffset} onCopyLines={copyLines} />
          </React.Suspense>
        )
        : (
          <div className='flex-1 flex flex-col min-h-0 bg-surface'>
            {!compact && (
              <div className='px-3 py-1 bg-sidebar border-b border-line text-[11px] font-semibold text-muted uppercase tracking-wider flex items-center justify-between gap-4'>
                <span>{isMarkdown ? t('editor.rawSource') : t('editor.plainTextSource')}</span>
                <span className='font-mono truncate'>{path}</span>
              </div>
            )}
            <div key={path} className='relative flex-1 flex min-h-0 overflow-hidden'>
              {suggestions.length > 0 && (
                <div role='listbox' aria-label={t('graph.findNote')} className='note-source-completions'>
                  {suggestions.map((note, index) => (
                    <button
                      type='button'
                      role='option'
                      aria-selected={index === choice % suggestions.length}
                      key={note.path}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => accept(note)}
                    >
                      {note.title}
                      <small>{note.notebookId}{' · '}{note.path}</small>
                    </button>
                  ))}
                </div>
              )}
              {showLineNumbers && (
                <div
                  data-source-line-numbers
                  aria-hidden='true'
                  className='w-12 shrink-0 overflow-hidden border-r border-line/70 bg-sidebar/60 text-muted/70'
                  onPointerMove={event => {
                    if (sourceDragStart.current === null) return;
                    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-line-number]');
                    const line = Number(target?.dataset.bodyLine);
                    if (Number.isFinite(line)) setDraggedSourceRange([sourceDragStart.current, line]);
                  }}
                  onPointerUp={event => {
                    if (sourceDragStart.current === null) return;
                    event.preventDefault();
                    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-line-number]');
                    const end = Number(target?.dataset.bodyLine);
                    const start = sourceDragStart.current;
                    sourceDragStart.current = null;
                    setDraggedSourceRange(null);
                    /* eslint-disable react/purity -- Read the event timestamp inside the pointer callback, after rendering. */
                    if (Number.isFinite(end) && start !== end) {
                      lastSourceGutterClick.current = null;
                      void copyLines(start, end);
                    } else lastSourceGutterClick.current = { line: start, at: performance.now() };
                    /* eslint-enable react/purity */
                  }}
                  onPointerCancel={() => {
                    sourceDragStart.current = null;
                    setDraggedSourceRange(null);
                  }}
                >
                  <div ref={sourceLineNumbers} className='py-4 pr-3 text-right font-mono text-xs tabular-nums' style={{ lineHeight: '1.421875rem' }}>
                    {Array.from({ length: sourceLineCount }, (_, index) => {
                      const line = index + 1;
                      const rangeStart = draggedSourceRange ? Math.min(...draggedSourceRange) : -1;
                      const rangeEnd = draggedSourceRange ? Math.max(...draggedSourceRange) : -1;
                      const inDraggedRange = line >= rangeStart && line <= rangeEnd;
                      return (
                        <div
                          key={index}
                          data-line-number
                          data-body-line={line}
                          data-active-line={line === activeSourceLine ? 'true' : undefined}
                          data-line-copy-selected={inDraggedRange ? 'true' : undefined}
                          onPointerDown={event => {
                            if (event.pointerType !== 'mouse' || event.button !== 0) return;
                            event.preventDefault();
                            const previous = lastSourceGutterClick.current;
                            if (previous?.line === line && performance.now() - previous.at < 500) {
                              lastSourceGutterClick.current = null;
                              lastSourceGutterCopy.current = { line, at: performance.now() };
                              void copyLines(line);
                              return;
                            }
                            sourceDragStart.current = line;
                            setDraggedSourceRange([line, line]);
                            event.currentTarget.setPointerCapture(event.pointerId);
                          }}
                          onDoubleClick={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            const recent = lastSourceGutterCopy.current;
                            if (recent?.line === line && performance.now() - recent.at < 500) return;
                            lastSourceGutterCopy.current = { line, at: performance.now() };
                            void copyLines(line);
                          }}
                          className={`cursor-default select-none origin-right transition-[background-color,color,opacity,transform,font-weight] duration-150 ${inDraggedRange ? 'bg-fg/10 text-fg' : ''} ${line === activeSourceLine ? 'scale-[1.08] font-semibold text-muted' : ''}`}
                        >
                          {line + lineNumberOffset}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <textarea
                ref={source}
                readOnly={readOnly}
                aria-label={ariaLabel}
                value={content}
                onChange={event => {
                  setDismissed(false);
                  setChoice(0);
                  updateActiveSourceLine(event.currentTarget);
                  onChange(event.target.value);
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || !suggestions.length) return;
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setChoice(value => (value + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    accept(suggestions[choice % suggestions.length]);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setDismissed(true);
                  }
                }}
                onFocus={event => updateActiveSourceLine(event.currentTarget)}
                onSelect={event => updateActiveSourceLine(event.currentTarget)}
                onScroll={event => {
                  if (sourceLineNumbers.current) sourceLineNumbers.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
                }}
                wrap='off'
                className='flex-1 min-w-0 min-h-0 px-4 py-4 font-mono text-sm text-fg bg-surface resize-none focus:outline-none'
                style={{ lineHeight: '1.421875rem' }}
                spellCheck={false}
              />
            </div>
          </div>
        )}
      {lineCopyFeedback && <div role='status' data-line-copy-feedback data-state={lineCopyFeedback.ok ? 'copied' : 'error'} className='pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs font-medium shadow-sm' style={{ backgroundColor: 'var(--color-text)', color: 'var(--color-bg)' }}>{lineCopyFeedback.ok ? t(lineCopyFeedback.start === lineCopyFeedback.end ? 'editor.lineCopied' : 'editor.linesCopied', { start: lineCopyFeedback.start, end: lineCopyFeedback.end }) : t('editor.lineCopyFailed')}</div>}
    </div>
  );
});
