import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { type DecorationSet, drawSelection, EditorView, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { autocompletion } from '@codemirror/autocomplete';
import { history, isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { codeMirrorTokenTheme, tokenHighlightStyle } from '../lib/codemirror-theme.js';
import { tags } from '@lezer/highlight';
import { headingSlug } from '../lib/workspace-links.js';
import { parseMarkdownOutline } from '../lib/note-navigation.js';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../lib/i18n/index.js';
import { useQueryClient } from '@tanstack/react-query';
import { fetchNoteCandidates, noteCompletionAt } from '../lib/note-completion.js';
import { useNoteQueryScope } from '../lib/use-note-queries.js';
import { noteLinkHref } from '@mygitnotes/core/workspace-links';
import { TASK_TOKEN_ICON_SVG } from '../lib/task-icons.js';
import { LiveMarkdownTable, tableUIState } from './LiveMarkdownTable.js';
import { chipEditState } from './live-markdown/chip-editing.js';
import { atCompletionSource } from './live-markdown/at-completion-source.js';
import { cjkEmphasis } from './live-markdown/cjk-emphasis.js';
import { anchorMermaidSwap } from './live-markdown/mermaid-scroll.js';
import { liveDecorations } from './live-markdown/decorations.js';
import { cardBackgroundLayer, theme } from './live-markdown/theme.js';
import { attachGutterLineCopy, blockWidgetLineNumbers } from './live-markdown/gutter-line-copy.js';
import { headingGutter } from './live-markdown/heading-gutter.js';
import { tableBoundaries } from './live-markdown/table-boundaries.js';
import { useNoteViewPreferences } from '../lib/editor-preferences.js';
import { applyMarkdownFormat, formatKeymap } from './live-markdown/format-commands.js';
import { markdownEditorKeymap } from './live-markdown/editor-keymap.js';
import type { MarkdownFormat } from '../lib/markdown-format.js';
import { isOutlinePath } from '@mygitnotes/core/outline';
import { applyOutlineCommand, outlineKeymap } from './live-markdown/outline-commands.js';
import { outlineDrag } from './live-markdown/outline-drag.js';
import type { OutlineCommand } from '../lib/outline-editing.js';
import { textChange } from '../lib/text-change.js';
import { blockInsertion } from '../lib/directive-editing.js';

export interface LiveMarkdownHandle {
  /** Inserts `text` at `at`, or in place of the selection. */
  insert: (text: string, at?: number) => void;
  /** Puts `block` in place of the selection as a block of its own, with exactly one blank line on either side. */
  insertBlock: (block: string) => void;
  revealRange: (from: number, to: number, focus?: boolean) => void;
  goToLine: (line: number, options?: { focus?: boolean; }) => void;
  getCurrentLine: () => number;
  getSelection: () => { from: number; to: number; } | null;
  ready: () => boolean;
  format: (format: MarkdownFormat) => void;
  outline: (command: OutlineCommand) => void;
}
interface Props {
  content: string;
  notePath: string;
  /** The note's notebook, so rendered assets reach its repository. */
  notebookId?: string;
  readOnly: boolean;
  ariaLabel?: string;
  onChange: (content: string) => void;
  /** The caret, and the other end of the selection when text is selected. */
  onCaret?: (position: number, end?: number) => void;
  showLineNumbers?: boolean;
  lineNumberOffset?: number;
  onCopyLines?: (firstLine: number, lastLine?: number) => void;
}
const focusChanged = StateEffect.define<boolean>();
let youtubeEditorSequence = 0;
export const LiveMarkdownEditor = forwardRef<LiveMarkdownHandle, Props>(({ content, notePath, notebookId, readOnly, onChange, onCaret, ariaLabel = 'Note content', showLineNumbers = true, lineNumberOffset = 0, onCopyLines }, ref) => {
  const { t } = useTranslation();
  const linkLabel = t('links.open');
  const tableLabel = t('preview.scrollableTable'), pageLabel = t('editor.page');
  const location = useLocation();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>();
  const youtubeOwner = useRef('');
  /* eslint-disable react/refs -- The persistent CodeMirror view reads current callbacks and options through refs. */
  if (!youtubeOwner.current) youtubeOwner.current = `youtube-editor-${++youtubeEditorSequence}`;
  /* eslint-enable react/refs */
  const callback = useRef(onChange);
  /* eslint-disable react/refs -- The persistent CodeMirror view reads current callbacks and options through refs. */
  callback.current = onChange;
  /* eslint-enable react/refs */
  const queryClient = useQueryClient();
  const scope = useNoteQueryScope();
  const completionSource = useRef({ queryClient, scope });
  /* eslint-disable react/refs -- The persistent CodeMirror view reads current callbacks and options through refs. */
  completionSource.current = { queryClient, scope };
  /* eslint-enable react/refs */
  const caretCallback = useRef(onCaret);
  /* eslint-disable react/refs -- The persistent CodeMirror view reads current callbacks and options through refs. */
  caretCallback.current = onCaret;
  /* eslint-enable react/refs */
  const permission = useRef(new Compartment());
  const lineNumberGutter = useRef(new Compartment());
  const copyLinesCallback = useRef(onCopyLines);
  /* eslint-disable react/refs -- The persistent CodeMirror view reads current callbacks and options through refs. */
  copyLinesCallback.current = onCopyLines;
  /* eslint-enable react/refs */
  const appliedAnchor = useRef('');
  const lineOffset = useRef(lineNumberOffset);
  /* eslint-disable react/refs -- The persistent CodeMirror view reads current callbacks and options through refs. */
  lineOffset.current = lineNumberOffset;
  /* eslint-enable react/refs */
  useImperativeHandle(ref, () => ({
    ready: () => Boolean(editor.current),
    getSelection: () => {
      const selection = editor.current?.state.selection.main;
      return selection ? { from: selection.from, to: selection.to } : null;
    },
    insert(text, at) {
      const view = editor.current;
      if (!view || view.state.readOnly) return;
      const from = at === undefined ? undefined : Math.max(0, Math.min(at, view.state.doc.length));
      const inserted = view.state.toText(text);
      view.dispatch(from === undefined ? view.state.replaceSelection(inserted) : { changes: { from, insert: inserted }, selection: { anchor: from + inserted.length } }, { scrollIntoView: true, userEvent: 'input', annotations: isOutlinePath(notePath) ? isolateHistory.of('full') : undefined });
      view.focus();
    },
    insertBlock(block) {
      const view = editor.current;
      if (!view || view.state.readOnly) return;
      const { from, to } = view.state.selection.main;
      const edit = blockInsertion(view.state.doc.toString(), from, to, block);
      view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.cursor }, scrollIntoView: true, userEvent: 'input', annotations: isOutlinePath(notePath) ? isolateHistory.of('full') : undefined });
      view.focus();
    },
    revealRange(from, to, focus = false) {
      const view = editor.current;
      if (!view) return;
      const start = Math.max(0, Math.min(from, view.state.doc.length));
      const end = Math.max(start, Math.min(to, view.state.doc.length));
      view.dispatch({ selection: { anchor: start, head: end }, effects: EditorView.scrollIntoView(start, { y: 'center' }) });
      if (focus) view.focus();
    },
    goToLine(line, options = {}) {
      const view = editor.current;
      if (!view) return;
      const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).from;
      // CodeMirror only measures the blocks it has rendered, so a scroll offset read from the height map
      // is an estimate that moves once the target region is measured, and that shift cancels a smooth
      // scroll mid-flight. Its own scrollIntoView re-applies the offset through the measure cycle until
      // the line really sits where it was asked to.
      view.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: 'start', yMargin: 20 }) });
      if (options.focus !== false) view.focus();
    },
    getCurrentLine() {
      const view = editor.current;
      if (!view) return 1;
      const atEnd = view.scrollDOM.scrollTop + view.scrollDOM.clientHeight >= view.scrollDOM.scrollHeight - 2;
      return atEnd ? view.state.doc.lines : view.state.doc.lineAt(view.viewport.from).number;
    },
    format(format) {
      if (editor.current) applyMarkdownFormat(editor.current, format);
    },
    outline(command) {
      if (editor.current && isOutlinePath(notePath)) {
        applyOutlineCommand(editor.current, command);
        editor.current.focus();
      }
    },
  }), [notePath]);
  /* eslint-disable react-hooks/exhaustive-deps -- CodeMirror owns selection, focus and undo history; content, read-only and gutter changes have separate view updates and must not recreate it. */
  useEffect(() => {
    const field = StateField.define<{ decorations: DecorationSet; focused: boolean; }>({
      create(state) {
        return { decorations: liveDecorations(state, false, notePath, linkLabel, tableLabel, pageLabel, youtubeOwner.current, t, notebookId), focused: false };
      },
      update(value, tr) {
        let focused = value.focused;
        for (const effect of tr.effects) if (effect.is(focusChanged)) focused = effect.value;
        return { focused, decorations: liveDecorations(tr.state, focused, notePath, linkLabel, tableLabel, pageLabel, youtubeOwner.current, t, notebookId) };
      },
      provide: field => EditorView.decorations.from(field, value => value.decorations),
    });
    const view = new EditorView({
      parent: host.current!,
      dispatchTransactions: anchorMermaidSwap,
      state: EditorState.create({
        doc: content,
        extensions: [
          markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }),
          history(),
          isOutlinePath(notePath) ? [outlineKeymap, outlineDrag({ move: t('outline.move'), before: t('outline.dropBefore'), after: t('outline.dropAfter'), child: t('outline.dropChild') })] : [],
          tableBoundaries,
          formatKeymap,
          markdownEditorKeymap(),
          drawSelection(),
          cardBackgroundLayer,
          headingGutter,
          lineNumberGutter.current.of(
            showLineNumbers
              ? [lineNumbers({ formatNumber: number => String(number + lineOffset.current) }), blockWidgetLineNumbers(lineOffset), highlightActiveLineGutter()]
              : [],
          ),
          EditorView.lineWrapping,
          syntaxHighlighting(tokenHighlightStyle),
          syntaxHighlighting(HighlightStyle.define([{ tag: tags.url, class: 'live-md-url' }, { tag: tags.contentSeparator, class: 'live-md-hr' }])),
          codeMirrorTokenTheme,
          theme,
          tableUIState,
          chipEditState,
          field,
          autocompletion({
            icons: false,
            addToOptions: [{
              position: 20,
              render: completion => {
                const icon = completion.type && TASK_TOKEN_ICON_SVG[completion.type];
                if (!icon) return null;
                const span = document.createElement('span');
                span.className = 'live-md-completion-icon';
                span.replaceChildren(new DOMParser().parseFromString(icon, 'image/svg+xml').documentElement);
                return span;
              },
            }],
            override: [atCompletionSource, async context => {
              const text = context.state.doc.toString(), match = noteCompletionAt(text, context.pos);
              if (!match || context.state.readOnly) return null;
              // Typing must not send one query per character; a superseded completion is dropped.
              await new Promise(resolve => setTimeout(resolve, 150));
              if (context.aborted) return null;
              const { queryClient: client, scope: current } = completionSource.current;
              const notes = await fetchNoteCandidates(client, current, match.query, notePath, isOutlinePath(notePath) ? notebookId : undefined);
              if (context.aborted) return null;
              return { from: match.from, to: match.to, filter: false, options: notes.map(note => ({ label: note.title, detail: `${note.notebookId} · ${note.path}`, apply: noteLinkHref(notePath, note.path) + (text[context.pos] === ')' ? '' : ')') })) };
            }],
          }),
          EditorView.atomicRanges.of(view => view.state.field(field).decorations.update({ filter: (_from, _to, decoration) => decoration.spec.widget instanceof LiveMarkdownTable })),
          permission.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'role': 'textbox', 'aria-multiline': 'true', 'data-key-scope': 'markdown-editor' }),
          EditorView.domEventHandlers({
            focus: (_event, view) => {
              view.dispatch({ effects: focusChanged.of(true) });
            },
            blur: (_event, view) => {
              view.dispatch({ effects: focusChanged.of(false) });
            },
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) callback.current(update.state.doc.toString());
            if ((update.selectionSet || update.docChanged || update.focusChanged) && update.view.hasFocus) caretCallback.current?.(update.state.selection.main.head, update.state.selection.main.anchor);
          }),
        ],
      }),
    });
    const detachGutterLineCopy = attachGutterLineCopy(view, { lineOffset, onCopyLines: copyLinesCallback });
    editor.current = view;
    return () => {
      detachGutterLineCopy();
      view.destroy();
      editor.current = undefined;
    };
  }, [notePath, notebookId, ariaLabel, linkLabel, tableLabel, pageLabel, t]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    const view = editor.current;
    // Only the changed span is replaced, so an outside edit keeps the scroll position, caret and selection.
    const change = view && textChange(view.state.doc.toString(), content);
    if (view && change) view.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
  }, [content]);
  useEffect(() => {
    editor.current?.dispatch({ effects: permission.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);
  // The host editor applies the view preferences as CSS variables; CodeMirror caches line heights and the
  // content box, so it re-measures once the new size and width are in the DOM.
  const viewPreferences = useNoteViewPreferences();
  useEffect(() => {
    editor.current?.requestMeasure();
  }, [viewPreferences]);
  useEffect(() => {
    editor.current?.dispatch({ effects: lineNumberGutter.current.reconfigure(showLineNumbers ? [lineNumbers({ formatNumber: number => String(number + lineNumberOffset) }), blockWidgetLineNumbers(lineOffset), highlightActiveLineGutter()] : []) });
  }, [showLineNumbers, lineNumberOffset]);
  useEffect(() => {
    const target = notePath + location.hash;
    if (!location.hash || appliedAnchor.current === target) return;
    let anchor: string;
    try {
      anchor = headingSlug(decodeURIComponent(location.hash.slice(1)));
    } catch {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const view = editor.current;
      // CodeMirror renders only the lines around the viewport, so a heading below it has no DOM node to
      // scroll to; the heading is located in the document text and the editor scrolls to its line. The
      // anchor applies once per note so that later edits leave the reader where they are.
      const heading = view && parseMarkdownOutline(view.state.doc.toString()).find(entry => headingSlug(entry.label) === anchor);
      if (!view || !heading) return;
      appliedAnchor.current = target;
      view.dispatch({ effects: EditorView.scrollIntoView(heading.from, { y: 'start', yMargin: 20 }) });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, notePath, content]);
  return <div ref={host} className='flex-1 min-h-0 min-w-0 overflow-hidden' data-live-markdown />;
});
