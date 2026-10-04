// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { autocompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { outlineKeymap } from './live-markdown/outline-commands.js';
import { renderNote } from '../lib/markdown.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { LiveMarkdownEditor } from './LiveMarkdownEditor.js';

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ initial, mode, readOnly = false, path = 'notes/ex/plan.outline.md' }: { initial: string; mode: 'live' | 'raw'; readOnly?: boolean; path?: string; }) {
  const [content, onChange] = useState(initial);
  return mode === 'live' ? createElement(LiveMarkdownEditor, { content, notePath: path, notebookId: 'ex', readOnly, onChange, ariaLabel: 'Outline content' }) : createElement(MarkdownEditor, { content, path, notebookId: 'ex', mode, readOnly, onChange, ariaLabel: 'Outline content' });
}
function mount(initial: string, mode: 'live' | 'raw', options: { readOnly?: boolean; path?: string; } = {}) {
  return render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(MemoryRouter, {}, createElement(Harness, { initial, mode, ...options }))));
}
const key = (target: Element, name: string, modifiers: Record<string, boolean> = {}) => fireEvent.keyDown(target, { key: name, keyCode: name === 'Enter' ? 13 : name === 'Tab' ? 9 : name === 'Escape' ? 27 : name.toUpperCase().charCodeAt(0), ...modifiers });

for (const mode of ['raw', 'live'] as const) {
  describe(`mounted ${mode} outline editor`, () => {
    const editor = () => {
      const element = screen.getByRole('textbox', { name: 'Outline content' });
      const view = mode === 'live' ? EditorView.findFromDOM(element) : null;
      return {
        element,
        text: () => view ? view.state.doc.toString() : (element as HTMLTextAreaElement).value,
        select: (from: number, to = from) =>
          act(() => {
            if (view) view.dispatch({ selection: { anchor: from, head: to } });
            else (element as HTMLTextAreaElement).setSelectionRange(from, to);
          }),
        caret: () => view ? view.state.selection.main.head : (element as HTMLTextAreaElement).selectionStart,
      };
    };

    it('inserts a sibling after descendants and undoes/redoes one transaction', async () => {
      const initial = '- Parent\n  annotation\n  - Child\n- Next';
      mount(initial, mode);
      const e = editor();
      e.select(8);
      key(e.element, 'Enter');
      expect(e.text()).toBe('- Parent\n  annotation\n  - Child\n- \n- Next');
      await waitFor(() => expect(e.caret()).toBe(34));
      key(e.element, 'z', { ctrlKey: true });
      expect(e.text()).toBe(initial);
      key(e.element, 'y', { ctrlKey: true });
      expect(e.text()).toBe('- Parent\n  annotation\n  - Child\n- \n- Next');
    });

    it('uses Shift+Enter for annotations and Tab/Shift+Tab for complete subtrees', async () => {
      mount('- First\n- Second\n  - Child', mode);
      const e = editor();
      e.select(16);
      key(e.element, 'Enter', { shiftKey: true });
      expect(e.text()).toBe('- First\n- Second\n  \n  - Child');
      await waitFor(() => expect(e.caret()).toBe(19));
      key(e.element, 'Tab');
      expect(e.text()).toBe('- First\n  - Second\n    \n    - Child');
      key(e.element, 'Tab', { shiftKey: true });
      expect(e.text()).toBe('- First\n- Second\n  \n  - Child');
    });

    it('splits selected inline text without deleting unselected child content', () => {
      mount('- Hello world\n  - Child\n- Next', mode);
      const e = editor();
      e.select(4, 8);
      key(e.element, 'Enter');
      expect(e.text()).toBe('- He\n  - Child\n- world\n- Next');
    });

    it('does not intercept composing keys, read-only content or Escape-Tab', () => {
      mount('- First\n- Second', mode);
      const e = editor();
      e.select(16);
      if (mode === 'live') fireEvent.compositionStart(e.element);
      key(e.element, 'Enter', { isComposing: true });
      expect(e.text()).toBe('- First\n- Second');
      if (mode === 'live') fireEvent.compositionEnd(e.element);
      key(e.element, 'Escape');
      expect(key(e.element, 'Tab')).toBe(true);
      expect(e.text()).toBe('- First\n- Second');
    });

    it('disallows outline commands while read-only', () => {
      mount('- First\n- Second', mode, { readOnly: true });
      const e = editor();
      e.select(16);
      key(e.element, 'Tab');
      expect(e.text()).toBe('- First\n- Second');
    });
  });
}

it('gives plain Enter to completion but keeps Shift+Enter an annotation command', async () => {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: '- Alp', selection: { anchor: 5 }, extensions: [markdown(), outlineKeymap, autocompletion({ override: [() => ({ from: 2, options: [{ label: 'Alpha' }] })], activateOnTyping: false, interactionDelay: 0 })] }) });
  try {
    startCompletion(view);
    await waitFor(() => expect(completionStatus(view.state)).toBe('active'));
    key(view.contentDOM, 'Enter');
    expect(view.state.doc.toString()).toBe('- Alpha');
    startCompletion(view);
    await waitFor(() => expect(completionStatus(view.state)).toBe('active'));
    key(view.contentDOM, 'Enter', { shiftKey: true });
    expect(view.state.doc.toString()).toBe('- Alpha\n  ');
  } finally {
    view.destroy();
  }
});

it('renders outline YouTube links without media previews in live and rendered Markdown', () => {
  const content = '- Read [reference](https://youtu.be/dQw4w9WgXcQ)\n\nhttps://youtu.be/dQw4w9WgXcQ';
  const { container } = mount(content, 'live');
  expect(container.querySelector('iframe, img[src], .note-youtube-embed')).toBeNull();
  const rendered = new DOMParser().parseFromString(renderNote(content, 'notes/ex/plan.outline.md'), 'text/html');
  expect(rendered.querySelector('iframe, img, .note-youtube-embed')).toBeNull();
  expect(rendered.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(rendered.querySelector('a')?.getAttribute('href')).toBe('https://youtu.be/dQw4w9WgXcQ');
});

it('keeps raw normal-note Tab native and exposes outline toolbar actions', () => {
  const normal = mount('- First\n- Second', 'raw', { path: 'notes/ex/plain.md' });
  const original = screen.getByRole<HTMLTextAreaElement>('textbox');
  original.setSelectionRange(16, 16);
  expect(key(original, 'Tab')).toBe(true);
  expect(original.value).toBe('- First\n- Second');
  expect(screen.queryByRole('button', { name: 'Indent item' })).toBeNull();
  normal.unmount();
  mount('- First\n- Second', 'raw');
  const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');
  textarea.setSelectionRange(16, 16);
  fireEvent.click(screen.getByRole('button', { name: 'Indent item' }));
  expect(textarea.value).toBe('- First\n  - Second');
});
