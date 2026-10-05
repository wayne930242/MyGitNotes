import { Select } from './Select.js';
import { bookmarkOriginalRange, normalizeBookmarkBody } from '@mygitnotes/core/bookmark-anchor';
import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bold, Code, Code2, Eye, Heading1, Heading2, Heading3, IndentDecrease, IndentIncrease, Italic, Link, Link2, List, ListOrdered, ListTodo, type LucideIcon, Plus, Quote, SeparatorHorizontal, Square, SquareCode, Strikethrough, Table2, Underline } from 'lucide-react';
import type { LiveMarkdownHandle } from './LiveMarkdownEditor.js';
import { type TranslationKey, useTranslation } from '../lib/i18n/index.js';
import { noteCompletionAt, useNoteCandidates } from '../lib/note-completion.js';
import { noteLinkHref, noteMarkdownLink } from '@mygitnotes/core/workspace-links';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { DIRECTIVE_TEMPLATES, localizedDirectiveSnippet } from '../lib/directive-editing.js';
import './note-completion.css';
import { copyLinePrompt } from '../lib/line-prompt-copy.js';
import { attachLineGutterGesture } from '../lib/line-gutter-gesture.js';
import { LoadingStatus } from './LoadingStatus.js';
import { applyEdits, formatMarkdown, type MarkdownFormat } from '../lib/markdown-format.js';
import { isOutlinePath } from '@mygitnotes/core/outline';
import { editOutline, type OutlineCommand } from '../lib/outline-editing.js';
import { OutlineRawHistory, type OutlineRawSnapshot } from '../lib/outline-raw-history.js';

const LiveMarkdownEditor = React.lazy(() => import('./LiveMarkdownEditor.js').then(module => ({ default: module.LiveMarkdownEditor })));
export type MarkdownEditorMode = 'live' | 'raw';
export interface MarkdownEditorHandle {
  /** Inserts `text` at `at`, or in place of the selection. */
  insert: (text: string, at?: number) => void;
  revealRange: (from: number, to: number, focus?: boolean) => void;
  goToLine: (line: number, options?: { focus?: boolean; smooth?: boolean; }) => void;
  getCurrentLine: () => number;
  getSelection: () => { from: number; to: number; } | null;
  ready: () => boolean;
}
interface Props {
  content: string;
  path: string;
  /** The note's notebook, so rendered assets reach its repository. */
  notebookId?: string;
  mode: MarkdownEditorMode;
  readOnly: boolean;
  onChange: (content: string) => void;
  ariaLabel?: string;
  /** The caret, and the other end of the selection when text is selected. */
  onCaret?: (position: number, end?: number) => void;
  compact?: boolean;
  /** The element that hosts the formatting toolbar; null hides it, and without one it sits in a row above the content. */
  toolbarSlot?: HTMLElement | null;
  showLineNumbers?: boolean;
  lineNumberOffset?: number;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The formatting toolbar's groups; a shortcut key is shown in the button's label. */
const FORMAT_GROUPS: { format: MarkdownFormat; icon: LucideIcon; key?: string; }[][] = [[{ format: 'heading1', icon: Heading1 }, { format: 'heading2', icon: Heading2 }, { format: 'heading3', icon: Heading3 }], [{ format: 'bold', icon: Bold, key: 'B' }, { format: 'italic', icon: Italic, key: 'I' }, { format: 'underline', icon: Underline, key: 'U' }, { format: 'strikethrough', icon: Strikethrough }, { format: 'code', icon: Code }], [{ format: 'bulletList', icon: List }, { format: 'orderedList', icon: ListOrdered }, { format: 'taskList', icon: ListTodo }, { format: 'quote', icon: Quote }], [{ format: 'codeBlock', icon: SquareCode }, { format: 'link', icon: Link }, { format: 'horizontalRule', icon: SeparatorHorizontal }]];
const SHORTCUT_FORMATS: Record<string, MarkdownFormat> = { b: 'bold', i: 'italic', u: 'underline' };

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

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(({ content, path, notebookId, mode, readOnly, onChange, onCaret, compact = false, toolbarSlot, ariaLabel = 'Document content', showLineNumbers = true, lineNumberOffset = 0 }, ref) => {
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
  const [sourceGutter, setSourceGutter] = useState<HTMLDivElement | null>(null);
  const [lineCopyFeedback, setLineCopyFeedback] = useState<{ ok: boolean; start: number; end: number; } | null>(null);
  const lineCopyTimer = useRef<ReturnType<typeof setTimeout>>();
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(path);
  const sourceLineCount = content.split('\n').length;
  const outline = isOutlinePath(path);
  const rawHistory = useRef(new OutlineRawHistory());
  const rawBeforeInput = useRef<OutlineRawSnapshot | null>(null);
  const tabEscape = useRef(false);
  const pendingRawSelection = useRef<OutlineRawSnapshot | null>(null);
  useLayoutEffect(() => {
    rawHistory.current = new OutlineRawHistory();
    rawBeforeInput.current = null;
    pendingRawSelection.current = null;
    tabEscape.current = false;
  }, [path, notebookId, mode]);
  const updateActiveSourceLine = (target: HTMLTextAreaElement) => {
    setActiveSourceLine(target.value.slice(0, target.selectionStart).split('\n').length);
    setCaret(target.selectionStart);
    onCaret?.(target.selectionStart, target.selectionEnd);
  };
  const rawSnapshot = (): OutlineRawSnapshot => {
    const range = bookmarkOriginalRange(content, { from: source.current?.selectionStart ?? 0, to: source.current?.selectionEnd ?? 0 });
    return { content, anchor: range.from, head: range.to };
  };
  const restoreRawSelection = (snapshot: OutlineRawSnapshot) => {
    pendingRawSelection.current = snapshot;
  };
  useLayoutEffect(() => {
    const snapshot = pendingRawSelection.current, target = source.current;
    if (!snapshot || !target || snapshot.content !== content) return;
    pendingRawSelection.current = null;
    const { offsets } = normalizeBookmarkBody(snapshot.content);
    target.focus();
    target.setSelectionRange(offsets.indexOf(snapshot.anchor), offsets.indexOf(snapshot.head));
    updateActiveSourceLine(target);
  });
  const changeSource = (next: string, selection?: { anchor: number; head: number; }, before = rawSnapshot(), restore = true) => {
    if (outline) rawHistory.current.record(before, { content: next, anchor: selection?.anchor ?? before.anchor, head: selection?.head ?? before.head });
    onChange(next);
    if (outline && selection && restore) restoreRawSelection({ content: next, ...selection });
  };
  const rawUndo = (redo: boolean) => {
    const snapshot = redo ? rawHistory.current.redo(content) : rawHistory.current.undo(content);
    if (snapshot) {
      onChange(snapshot.content);
      restoreRawSelection(snapshot);
    }
  };
  const applyOutline = (command: OutlineCommand): boolean => {
    if (!outline || readOnly) return false;
    if (mode === 'live') {
      live.current?.outline(command);
      return true;
    }
    const before = rawSnapshot();
    const result = editOutline(content, before.anchor, before.head, command);
    if (!result) return false;
    if (result.changes.length) changeSource(applyEdits(content, result.changes), result, before);
    return true;
  };

  const copyLines = async (firstBodyLine: number, lastBodyLine = firstBodyLine) => {
    const firstBody = Math.min(firstBodyLine, lastBodyLine), lastBody = Math.max(firstBodyLine, lastBodyLine);
    const start = firstBody + lineNumberOffset, end = lastBody + lineNumberOffset;
    const ok = await copyLinePrompt(path, start, end, content.split('\n').slice(firstBody - 1, lastBody).join('\n'));
    setLineCopyFeedback({ ok, start, end });
    clearTimeout(lineCopyTimer.current);
    lineCopyTimer.current = setTimeout(() => setLineCopyFeedback(null), 2000);
  };
  useEffect(() => () => clearTimeout(lineCopyTimer.current), []);
  const copyLinesRef = useRef(copyLines);
  // eslint-disable-next-line react-hooks/refs -- The gesture is attached once per gutter element and must call the latest copy handler.
  copyLinesRef.current = copyLines;
  useEffect(() => {
    const textarea = source.current;
    if (!sourceGutter || !textarea) return;
    return attachLineGutterGesture({
      gutter: sourceGutter,
      scroller: textarea,
      lineFromTarget: target => {
        const line = Number(target.closest<HTMLElement>('[data-line-number]')?.dataset.bodyLine);
        return Number.isFinite(line) ? line : null;
      },
      lineAtY: y => {
        const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22.75;
        const top = textarea.getBoundingClientRect().top + (parseFloat(getComputedStyle(textarea).paddingTop) || 0);
        return Math.min(Math.max(Math.floor((y - top + textarea.scrollTop) / lineHeight) + 1, 1), textarea.value.split('\n').length);
      },
      lineHeight: () => parseFloat(getComputedStyle(textarea).lineHeight) || 22.75,
      // Scrolling repeats the same range every frame; returning the previous state skips the re-render.
      onPreview: range => setDraggedSourceRange(previous => previous?.[0] === range?.[0] && previous?.[1] === range?.[1] ? previous : range),
      onCopy: (first, last) => void copyLinesRef.current(first, last),
    });
  }, [sourceGutter]);

  const [sourceIdentity, setSourceIdentity] = useState({ path, mode });
  if (sourceIdentity.path !== path || sourceIdentity.mode !== mode) {
    setSourceIdentity({ path, mode });
    setActiveSourceLine(1);
  }
  const match = !readOnly && mode === 'raw' && !dismissed && caret !== null ? noteCompletionAt(content, caret) : null;
  const suggestions = useNoteCandidates(match ? match.query : null, path, isOutlinePath(path) ? notebookId : undefined);
  const pickerCandidates = useNoteCandidates(picker ? query : null, path, isOutlinePath(path) ? notebookId : undefined);
  const accept = (note: NoteListItem) => {
    if (!match) return;
    const insert = noteLinkHref(path, note.path) + (content[match.to] === ')' ? '' : ')');
    changeSource(content.slice(0, match.from) + insert + content.slice(match.to));
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
      changeSource(content.slice(0, position) + text + content.slice(position));
    }
    setPicker(false);
  };

  const insertDirective = (type = 'info') => {
    const text = `\n\n${localizedDirectiveSnippet(type, t)}\n`;
    if (mode === 'live') live.current?.insert(text);
    else {
      const position = source.current?.selectionStart ?? content.length;
      changeSource(content.slice(0, position) + text + content.slice(position));
    }
  };

  const insertTable = () => {
    const text = `\n\n| ${t('table.column')} 1 | ${t('table.column')} 2 |\n| --- | --- |\n|  |  |\n\n`;
    if (mode === 'live') live.current?.insert(text);
    else {
      const position = source.current?.selectionStart ?? content.length;
      changeSource(content.slice(0, position) + text + content.slice(position));
    }
  };
  const applyFormat = (format: MarkdownFormat) => {
    if (readOnly) return;
    if (mode === 'live') {
      live.current?.format(format);
      return;
    }
    const target = source.current;
    if (!target) return;
    const selection = outline ? rawSnapshot() : { anchor: target.selectionStart, head: target.selectionEnd };
    const result = formatMarkdown(content, selection.anchor, selection.head, format);
    changeSource(applyEdits(content, result.changes), result);
    if (outline) return;
    requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(result.anchor, result.head);
      updateActiveSourceLine(target);
    });
  };
  const toolbar = isMarkdown && !readOnly && !compact
    ? (
      <div className='markdown-format-toolbar' role='toolbar' aria-label={t('editor.formatToolbar')}>
        {FORMAT_GROUPS.map((group, index) => (
          <div className='markdown-format-group' key={index}>
            {group.map(({ format, icon: Icon, key }) => {
              const label = t(`format.${format}` as TranslationKey) + (key ? ` (${isMac ? '⌘' : 'Ctrl+'}${key})` : '');
              return (
                <button
                  key={format}
                  type='button'
                  className='ui-icon-button toolbar-icon-button'
                  aria-label={label}
                  title={label}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => applyFormat(format)}
                >
                  <Icon aria-hidden='true' />
                </button>
              );
            })}
          </div>
        ))}
        {outline && (
          <div className='markdown-format-group'>
            {([['outdent', IndentDecrease], ['indent', IndentIncrease]] as const).map(([command, Icon]) => (
              <button
                key={command}
                type='button'
                className='ui-icon-button toolbar-icon-button'
                aria-label={t(`outline.${command}`)}
                title={t(`outline.${command}`)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => applyOutline(command)}
              >
                <Icon aria-hidden='true' />
              </button>
            ))}
          </div>
        )}
        <div className='markdown-format-group'>
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
        </div>
      </div>
    )
    : null;

  useImperativeHandle(ref, () => ({
    ready: () => mode === 'live' && isMarkdown ? Boolean(live.current?.ready()) : Boolean(source.current),
    getSelection() {
      if (mode === 'live' && isMarkdown) {
        const range = live.current?.getSelection();
        return range ? bookmarkOriginalRange(content, range) : null;
      }
      return source.current ? bookmarkOriginalRange(content, { from: source.current.selectionStart, to: source.current.selectionEnd }) : null;
    },
    insert(text, at) {
      if (readOnly) return;
      if (mode === 'live' && isMarkdown) {
        live.current?.insert(text, at);
        return;
      }
      const start = at ?? source.current?.selectionStart ?? content.length;
      const end = at ?? source.current?.selectionEnd ?? content.length;
      changeSource(content.slice(0, start) + text + content.slice(end));
      requestAnimationFrame(() => {
        source.current?.focus();
        source.current?.setSelectionRange(start + text.length, start + text.length);
      });
    },
    revealRange(from, to, focus = false) {
      if (mode === 'live' && isMarkdown) {
        const { offsets } = normalizeBookmarkBody(content);
        live.current?.revealRange(offsets.indexOf(from), offsets.indexOf(to), focus);
        return;
      }
      const target = source.current;
      if (!target) return;
      // Textareas normalize CRLF on assignment, just like the live editor's document.
      const { offsets } = normalizeBookmarkBody(content);
      const start = Math.max(0, Math.min(offsets.indexOf(from), target.value.length));
      const end = Math.max(start, Math.min(offsets.indexOf(to), target.value.length));
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
  }));

  return (
    <div className='relative flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden' data-markdown-editor>
      {toolbar && (toolbarSlot === undefined ? <div className='markdown-insert-toolbar'>{toolbar}</div> : toolbarSlot && createPortal(toolbar, toolbarSlot))}
      {outline && !readOnly && !compact && <p className='px-3 py-1 text-xs text-muted' data-outline-hint>{t('outline.keys')}</p>}
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
              key={`${note.notebookId}:${note.path}`}
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
          <React.Suspense fallback={<LoadingStatus className='p-6 text-sm text-muted'>{t('editor.loadingEditor')}</LoadingStatus>}>
            <LiveMarkdownEditor key={path} ref={live} content={content} notePath={path} notebookId={notebookId} readOnly={readOnly} onChange={onChange} onCaret={onCaret} ariaLabel={ariaLabel} showLineNumbers={showLineNumbers} lineNumberOffset={lineNumberOffset} onCopyLines={copyLines} />
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
                      key={`${note.notebookId}:${note.path}`}
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
                <div ref={setSourceGutter} data-source-line-numbers aria-hidden='true' className='w-12 shrink-0 overflow-hidden border-r border-line/70 bg-sidebar/60 text-muted/70 touch-none select-none'>
                  <div ref={sourceLineNumbers} className='py-4 pr-3 text-right font-mono text-xs tabular-nums' style={{ lineHeight: '1.421875rem' }}>
                    {Array.from({ length: sourceLineCount }, (_, index) => {
                      const line = index + 1;
                      const rangeStart = draggedSourceRange ? Math.min(...draggedSourceRange) : -1;
                      const rangeEnd = draggedSourceRange ? Math.max(...draggedSourceRange) : -1;
                      const inDraggedRange = line >= rangeStart && line <= rangeEnd;
                      return <div key={index} data-line-number data-body-line={line} data-active-line={line === activeSourceLine ? 'true' : undefined} data-line-copy-selected={inDraggedRange ? 'true' : undefined} className={`cursor-default select-none transition-[background-color,color] duration-150 ${inDraggedRange ? 'bg-fg/10 text-fg' : ''} ${line === activeSourceLine ? 'font-semibold text-muted' : ''}`}>{line + lineNumberOffset}</div>;
                    })}
                  </div>
                </div>
              )}
              <textarea
                ref={source}
                readOnly={readOnly}
                aria-label={ariaLabel}
                value={content}
                onBeforeInput={() => {
                  if (outline && !readOnly) rawBeforeInput.current = rawSnapshot();
                }}
                onChange={event => {
                  setDismissed(false);
                  setChoice(0);
                  updateActiveSourceLine(event.currentTarget);
                  changeSource(event.target.value, { anchor: event.currentTarget.selectionStart, head: event.currentTarget.selectionEnd }, rawBeforeInput.current ?? rawSnapshot(), false);
                  rawBeforeInput.current = null;
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return;
                  const shortcut = SHORTCUT_FORMATS[event.key.toLowerCase()];
                  if (shortcut && isMarkdown && !readOnly && (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.shiftKey && !event.altKey) {
                    event.preventDefault();
                    applyFormat(shortcut);
                    return;
                  }
                  if (outline && !readOnly && (isMac ? event.metaKey : event.ctrlKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
                    event.preventDefault();
                    rawUndo(event.shiftKey || event.key.toLowerCase() === 'y');
                    return;
                  }
                  const escaped = tabEscape.current;
                  tabEscape.current = event.key === 'Escape';
                  if (outline && !readOnly && !event.altKey && !event.metaKey && !event.ctrlKey && !(event.key === 'Tab' && escaped)) {
                    const command = event.key === 'Enter' ? event.shiftKey ? 'annotation' : suggestions.length ? null : 'sibling' : event.key === 'Tab' ? event.shiftKey ? 'outdent' : 'indent' : null;
                    if (command && applyOutline(command)) {
                      event.preventDefault();
                      return;
                    }
                  }
                  if (!suggestions.length) return;
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setChoice(value => (value + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
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
