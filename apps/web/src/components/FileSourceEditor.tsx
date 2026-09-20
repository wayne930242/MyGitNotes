import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { codeMirrorTokenTheme, tokenHighlightStyle } from '../lib/codemirror-theme.js';
import { markdown } from '@codemirror/lang-markdown';
import { cjkEmphasis } from './live-markdown/cjk-emphasis.js';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';

function language(path: string) {
  if (/\.(md|markdown|mdx)$/i.test(path)) return markdown({ extensions: [cjkEmphasis] });
  if (/\.[cm]?[jt]sx?$/i.test(path)) return javascript({ typescript: /\.[cm]?tsx?$/i.test(path), jsx: /x$/i.test(path) });
  if (/\.json$/i.test(path)) return json();
  if (/\.css$/i.test(path)) return css();
  if (/\.(html?|svg|xml)$/i.test(path)) return html();
  if (/\.ya?ml$/i.test(path)) return yaml();
  return [];
}
export function FileSourceEditor({ path, content, readOnly, label, onChange }: { path: string; content: string; readOnly: boolean; label: string; onChange: (value: string) => void; }) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView>();
  const permissions = useRef(new Compartment());
  const change = useRef(onChange);
  /* eslint-disable react/refs -- Keep the current callback in a ref for an imperative listener without recreating its subscription. */
  change.current = onChange;
  /* eslint-enable react/refs */
  const initial = useRef(content);
  /* eslint-disable react-hooks/exhaustive-deps -- CodeMirror owns selection and undo history; content and permission updates reconfigure the existing view instead of recreating it. */
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          language(path),
          syntaxHighlighting(tokenHighlightStyle),
          codeMirrorTokenTheme,
          permissions.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorState.lineSeparator.of(initial.current.includes('\r\n') ? '\r\n' : '\n'),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) change.current(update.state.sliceDoc());
          }),
          EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace', fontSize: '13px' }, '.cm-content': { minHeight: '260px' }, '.cm-gutters': { backgroundColor: 'var(--color-bg)', color: 'var(--color-muted)', borderColor: 'var(--color-border)' } }),
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
  }, [path, label]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => {
    view.current?.dispatch({ effects: permissions.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.sliceDoc() !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
    initial.current = content;
  }, [content]);
  return <div ref={host} className='file-source-editor' />;
}
