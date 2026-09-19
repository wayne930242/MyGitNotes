// @vitest-environment jsdom
import { createElement, forwardRef, useImperativeHandle, type ChangeEvent } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: () => null,
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; onChange: (content: string) => void }>(
    ({ content, onChange }, ref) => {
      useImperativeHandle(ref, () => ({ insert() {}, revealRange() {}, goToLine() {}, getCurrentLine: () => 1 }), []);
      return createElement('textarea', {
        'aria-label': 'Note content', value: content,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
      });
    }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Frontmatter lives in `metadata`, not `content`, so a correct copy carries only the body.
const note = { id: 'a', path: 'notes/a/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha', tags: ['x'] }, content: '# Alpha\n\nBody text.' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, {
  note, frame: 'compact', active: false, statuses: [], onSave: async () => note, onRestoreFile: async () => null,
  branch: 'main', draftScope: 'src:main', ...props,
} as NoteEditorProps));

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText: vi.fn(writeText) } });
}

it('copies the note body only, in compact mode, and reports success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubClipboard(writeText);
  render(editor({}));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note' })); });
  expect(writeText).toHaveBeenCalledWith('# Alpha\n\nBody text.');
  expect(screen.getByRole('button', { name: 'Note copied' })).toBeInTheDocument();
});

it('reports failure when the clipboard write fails, in compact mode', async () => {
  stubClipboard(() => Promise.reject(new Error('denied')));
  document.execCommand = vi.fn().mockReturnValue(false);
  render(editor({}));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note' })); });
  expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
});

it('copies the note body from the toolbar button outside compact mode', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubClipboard(writeText);
  render(editor({ frame: 'pane' }));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note' })); });
  expect(writeText).toHaveBeenCalledWith('# Alpha\n\nBody text.');
  expect(screen.getByRole('button', { name: 'Note copied' })).toBeInTheDocument();
});
