// @vitest-environment jsdom
import { createElement, forwardRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteEditingProvider } from '../lib/note-editing.js';
import { PanelProvider, usePanelContext } from '../lib/panel-context.js';
import { EditorModal } from './EditorModal.js';
import type { NoteEditorProps } from './NoteEditor.js';

vi.mock('./NoteEditor.js', () => ({ NoteEditor: forwardRef<unknown, NoteEditorProps>(({ onMove }, _ref) => createElement('div', { 'data-testid': 'editor' }, onMove && createElement('button', { type: 'button', onClick: onMove }, 'Move note'))) }));

afterEach(cleanup);

const Rail = () => createElement('output', { 'aria-label': 'rail' }, usePanelContext().hasOpenNote ? 'hidden' : 'shown');

it('hides the workspace rail while zoom waits for the note, as zoom itself does', () => {
  const modal = (loading: boolean, isOpen = true) => createElement(PanelProvider, null, createElement(Rail), createElement(EditorModal, { note: null, loading, isOpen, renderCompilation: () => null }));
  const { rerender } = render(modal(true));
  expect(screen.getByText('Loading note…')).toBeTruthy();
  expect(screen.getByLabelText('rail').textContent).toBe('hidden');
  rerender(modal(false, false));
  expect(screen.getByLabelText('rail').textContent).toBe('shown');
});

it('offers the Move action in zoom, where a new note is filed from its root', () => {
  const note = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: {}, content: '# Alpha' };
  const move = vi.fn();
  const moveNote = vi.fn(() => move);
  /* eslint-disable react/no-children-prop -- The provider's props type names its children. */
  render(createElement(NoteEditingProvider, { register: () => () => {}, flushEditors: async () => true, refreshNotes: async () => {}, closeZoom: () => {}, addToFocus: () => undefined, moveNote, editorProps: () => ({ statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' }), children: createElement(EditorModal, { note, loading: false, isOpen: true, renderCompilation: () => null }) }));
  /* eslint-enable react/no-children-prop */
  fireEvent.click(screen.getByRole('button', { name: 'Move note' }));
  expect(moveNote).toHaveBeenCalledWith(note);
  expect(move).toHaveBeenCalledOnce();
});

it('keeps a zoomed compilation mounted, hidden, behind a note opened from it, and shows the same view again when the note closes', () => {
  const note = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: {}, content: '# Alpha' };
  const compilation = { ...note, id: 'c', path: 'notes/reading.compilation.yml', title: 'Reading' };
  let mounts = 0;
  const View = () => {
    useState(() => ++mounts);
    return createElement('p', null, 'compilation view');
  };
  const modal = (props: { note: typeof note; behind?: { notebookId: string; path: string; }; }) =>
    /* eslint-disable react/no-children-prop -- The provider's props type names its children. */
    createElement(NoteEditingProvider, { register: () => () => {}, flushEditors: async () => true, refreshNotes: async () => {}, closeZoom: () => {}, addToFocus: () => undefined, editorProps: () => ({ statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' }), children: createElement(EditorModal, { ...props, loading: false, isOpen: true, renderCompilation: () => createElement(View) }) });
  /* eslint-enable react/no-children-prop */
  const { rerender } = render(modal({ note: compilation }));
  const frame = screen.getByRole('dialog', { name: 'Compilation' });
  expect(frame.parentElement).not.toHaveAttribute('data-behind');
  rerender(modal({ note, behind: { notebookId: 'a', path: compilation.path } }));
  expect(document.querySelector('[aria-label="Compilation"]')).toBe(frame);
  expect(frame.parentElement).toHaveAttribute('data-behind');
  expect(frame.parentElement).toHaveStyle({ visibility: 'hidden' });
  expect(screen.getByTestId('editor')).toBeTruthy();
  rerender(modal({ note: compilation }));
  expect(screen.getByRole('dialog', { name: 'Compilation' })).toBe(frame);
  expect(frame.parentElement).not.toHaveAttribute('data-behind');
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(mounts).toBe(1);
});
