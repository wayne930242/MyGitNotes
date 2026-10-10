// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef, useImperativeHandle } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { NoteEditor } from './NoteEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: () => null,
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; mode: string; readOnly: boolean; continuous?: boolean; showLineNumbers?: boolean; onChange: (content: string) => void; }>(({ content, mode, readOnly, continuous, showLineNumbers, onChange }, ref) => {
    useImperativeHandle(ref, () => ({ insert() {}, revealRange() {}, goToLine() {}, getCurrentLine: () => 1, getSelection: () => null, ready: () => true }), []);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, 'data-continuous': continuous ? 'true' : undefined, 'data-line-numbers': String(showLineNumbers), 'data-mode': mode, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) });
  }),
}));

afterEach(cleanup);

const note = { id: 'a', path: 'notes/a/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (extra: object = {}) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'inline', active: false, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...extra }));

it("shows the note as it reads with one line of save state, and none of the full editor's chrome (E15)", () => {
  const { container } = render(editor());
  expect(container.querySelector('.note-editor')).toHaveAttribute('data-frame', 'inline');
  // The body is the live editor in a continuous column with no line numbers; nothing offers source mode, export or a path.
  expect(screen.getByLabelText('Note content')).toHaveAttribute('data-continuous', 'true');
  expect(screen.getByLabelText('Note content')).toHaveAttribute('data-mode', 'live');
  expect(screen.getByLabelText('Note content')).toHaveAttribute('data-line-numbers', 'false');
  for (const chrome of ['.note-toolbar', '.note-footer', '.note-compact-bar', '.note-compact-path', '[data-mode-toggle]', '.note-document-panel', '.note-format-toolbar', 'button']) expect(container.querySelector(chrome)).toBeNull();
  const status = container.querySelector('.note-inline-status');
  expect(status).toHaveAttribute('data-state', 'saved');
  expect(status).toHaveTextContent('Clean (Saved to disk)');
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  expect(container.querySelector('.note-inline-status')).toHaveAttribute('data-state', 'pending');
});

it("keeps the editor's own notices: a conflict still shows above the note, and the note cannot be edited meanwhile", () => {
  const { container } = render(editor({ conflictReason: 'editor.remoteConflict', onMarkConflict: vi.fn() }));
  expect(container.querySelector('.editor-notice-error')).toHaveTextContent('Remote changes conflict with your draft.');
  expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
});
