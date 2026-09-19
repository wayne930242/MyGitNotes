import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { type DecorationSet, drawSelection, EditorView, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { codeMirrorTokenTheme, tokenHighlightStyle } from '../lib/codemirror-theme.js';
import { tags } from '@lezer/highlight';
import { headingSlug } from '../lib/workspace-links.js';
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
import { liveDecorations } from './live-markdown/decorations.js';
import { cardBackgroundLayer, theme } from './live-markdown/theme.js';
import { attachGutterLineCopy } from './live-markdown/gutter-line-copy.js';

export interface LiveMarkdownHandle {
  /** Inserts `text` at `at`, or in place of the selection. */
  insert: (text: string, at?: number) => void;
  revealRange: (from: number, to: number, focus?: boolean) => void;
  goToLine: (line: number, options?: { focus?: boolean; smooth?: boolean; }) => void;
  getCurrentLine: () => number;
}
interface Props {
  content: string;
  notePath: string;
  readOnly: boolean;
  ariaLabel?: string;
  onChange: (content: string) => void;
  onCaret?: (position: number) => void;
  showLineNumbers?: boolean;
  lineNumberOffset?: number;
  onCopyLines?: (firstLine: number, lastLine?: number) => void;
}
const focusChanged = StateEffect.define<boolean>();
let youtubeEditorSequence = 0;
export const LiveMarkdownEditor = forwardRef<LiveMarkdownHandle, Props>(({ content, notePath, readOnly, onChange, onCaret, ariaLabel = 'Note content', showLineNumbers = true, lineNumberOffset = 0, onCopyLines }, ref) => {
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
  const lineOffset = useRef(lineNumberOffset);
  /* eslint-disable react/refs -- The persistent CodeMirror view reads current callbacks and options through refs. */
  lineOffset.current = lineNumberOffset;
  /* eslint-enable react/refs */
  useImperativeHandle(ref, () => ({
    insert(text, at) {
      const view = editor.current;
      if (!view || view.state.readOnly) return;
      const from = at === undefined ? undefined : Math.max(0, Math.min(at, view.state.doc.length));
      view.dispatch(from === undefined ? view.state.replaceSelection(text) : { changes: { from, insert: text }, selection: { anchor: from + text.length } }, { scrollIntoView: true, userEvent: 'input' });
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
      view.dispatch({ selection: { anchor: target } });
      if (options.smooth) requestAnimationFrame(() => view.scrollDOM.scrollTo({ top: Math.max(0, view.lineBlockAt(target).top - 20), behavior: 'smooth' }));
      else view.dispatch({ effects: EditorView.scrollIntoView(target, { y: 'start', yMargin: 20 }) });
      if (options.focus !== false) view.focus();
    },
    getCurrentLine() {
      const view = editor.current;
      if (!view) return 1;
      const atEnd = view.scrollDOM.scrollTop + view.scrollDOM.clientHeight >= view.scrollDOM.scrollHeight - 2;
      return atEnd ? view.state.doc.lines : view.state.doc.lineAt(view.viewport.from).number;
    },
  }), []);
  /* eslint-disable react-hooks/exhaustive-deps -- Create the CodeMirror view for its identity; separate effects update content, permissions and line numbers. */
  useEffect(() => {
    const field = StateField.define<{ decorations: DecorationSet; focused: boolean; }>({
      create(state) {
        return { decorations: liveDecorations(state, false, notePath, linkLabel, tableLabel, pageLabel, youtubeOwner.current, t), focused: false };
      },
      update(value, tr) {
        let focused = value.focused;
        for (const effect of tr.effects) if (effect.is(focusChanged)) focused = effect.value;
        return { focused, decorations: liveDecorations(tr.state, focused, notePath, linkLabel, tableLabel, pageLabel, youtubeOwner.current, t) };
      },
      provide: field => EditorView.decorations.from(field, value => value.decorations),
    });
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: content,
        extensions: [
          markdown({ base: markdownLanguage }),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          drawSelection(),
          cardBackgroundLayer,
          lineNumberGutter.current.of(
            showLineNumbers
              ? [lineNumbers({ formatNumber: number => String(number + lineOffset.current) }), highlightActiveLineGutter()]
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
                span.innerHTML = icon;
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
              const notes = await fetchNoteCandidates(client, current, match.query, notePath);
              if (context.aborted) return null;
              return { from: match.from, to: match.to, filter: false, options: notes.map(note => ({ label: note.title, detail: `${note.notebookId} · ${note.path}`, apply: noteLinkHref(notePath, note.path) + (text[context.pos] === ')' ? '' : ')') })) };
            }],
          }),
          EditorView.atomicRanges.of(view => view.state.field(field).decorations.update({ filter: (_from, _to, decoration) => decoration.spec.widget instanceof LiveMarkdownTable })),
          permission.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'role': 'textbox', 'aria-multiline': 'true' }),
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
            if ((update.selectionSet || update.docChanged || update.focusChanged) && update.view.hasFocus) caretCallback.current?.(update.state.selection.main.head);
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
  }, [notePath, ariaLabel, linkLabel, tableLabel, pageLabel, t]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== content) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, annotations: Transaction.addToHistory.of(false) });
  }, [content]);
  useEffect(() => {
    editor.current?.dispatch({ effects: permission.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);
  useEffect(() => {
    editor.current?.dispatch({ effects: lineNumberGutter.current.reconfigure(showLineNumbers ? [lineNumbers({ formatNumber: number => String(number + lineNumberOffset) }), highlightActiveLineGutter()] : []) });
  }, [showLineNumbers, lineNumberOffset]);
  useEffect(() => {
    if (!location.hash) return;
    let anchor: string;
    try {
      anchor = headingSlug(decodeURIComponent(location.hash.slice(1)));
    } catch {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const heading = [...(host.current?.querySelectorAll<HTMLElement>('[data-heading-slug]') || [])].find(node => node.dataset.headingSlug === anchor);
      heading?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, notePath, content]);
  return <div ref={host} className='flex-1 min-h-0 min-w-0 overflow-hidden' data-live-markdown />;
});
