// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PanelProvider } from '../lib/panel-context.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditorModeSwitch: () => null, MarkdownEditor: forwardRef<unknown, { content: string; onChange: (content: string) => void; }>(({ content, onChange }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) })) }));

afterEach(cleanup);

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps));

it('leaves zoom from the heading at the left, apart from the document-panel toggle', async () => {
  const onClose = vi.fn();
  const { container } = render(editor({ onClose }));
  const back = screen.getByRole('button', { name: 'Close note' });
  expect(container.querySelector('.note-heading')?.firstElementChild).toBe(back);
  expect(container.querySelector('.note-controls')?.contains(back)).toBe(false);

  await act(async () => {
    fireEvent.click(back);
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('collapses the document panel from its own tab row', async () => {
  const { container } = render(editor({ onClose: () => {} }));
  const panel = () => container.querySelector('.note-document-panel');
  fireEvent.click(screen.getByRole('button', { name: 'Document tools' }));
  expect(panel()?.getAttribute('data-open')).toBe('true');

  const collapse = screen.getByRole('button', { name: 'Collapse document tools' });
  // The collapse action is not a tab, so it stays outside the tablist.
  expect(collapse.closest('[role="tablist"]')).toBeNull();
  fireEvent.click(collapse);
  expect(panel()?.getAttribute('data-open')).toBe('false');
});
