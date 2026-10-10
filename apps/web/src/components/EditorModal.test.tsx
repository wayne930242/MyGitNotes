// @vitest-environment jsdom
import { createElement, forwardRef, useLayoutEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteEditingProvider } from '../lib/note-editing.js';
import { PanelProvider, usePanelContext } from '../lib/panel-context.js';
import { EditorModal } from './EditorModal.js';
import type { NoteEditorProps } from './NoteEditor.js';

// Like the real editor, a zoom frame's editor holds the workspace rail hidden while it is mounted.
vi.mock('./NoteEditor.js', () => ({
  NoteEditor: forwardRef<unknown, NoteEditorProps>(({ onMove, frame }, _ref) => {
    const { setHasOpenNote } = usePanelContext();
    useLayoutEffect(() => {
      if (frame !== 'zoom') return;
      setHasOpenNote(true);
      return () => setHasOpenNote(false);
    }, [frame, setHasOpenNote]);
    return createElement('div', { 'data-testid': 'editor' }, onMove && createElement('button', { type: 'button', onClick: onMove }, 'Move note'));
  }),
}));

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
  render(createElement(PanelProvider, null, createElement(NoteEditingProvider, { register: () => () => {}, flushEditors: async () => true, refreshNotes: async () => {}, closeZoom: () => {}, addToFocus: () => undefined, moveNote, editorProps: () => ({ statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' }), children: createElement(EditorModal, { note, loading: false, isOpen: true, renderCompilation: () => null }) })));
  /* eslint-enable react/no-children-prop */
  fireEvent.click(screen.getByRole('button', { name: 'Move note' }));
  expect(moveNote).toHaveBeenCalledWith(note);
  expect(move).toHaveBeenCalledOnce();
});

const alpha = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: {}, content: '# Alpha' };
const reading = { ...alpha, id: 'c', path: 'notes/reading.compilation.yml', title: 'Reading' };
let mounts = 0;
/** A compilation view as the real one behaves: it holds the rail hidden while mounted and offers a control that opened a note. */
const View = () => {
  const { setHasOpenNote } = usePanelContext();
  useState(() => ++mounts);
  useLayoutEffect(() => {
    setHasOpenNote(true);
    return () => setHasOpenNote(false);
  }, [setHasOpenNote]);
  return createElement('button', { type: 'button' }, 'Open Alpha');
};
/* eslint-disable react/no-children-prop -- The provider's props type names its children. */
const modal = (props: { note: typeof alpha | null; loading?: boolean; behind?: { notebookId: string; path: string; }; }) => createElement(PanelProvider, null, createElement(Rail), createElement(NoteEditingProvider, { register: () => () => {}, flushEditors: async () => true, refreshNotes: async () => {}, closeZoom: () => {}, addToFocus: () => undefined, editorProps: () => ({ statuses: [], onSave: async () => alpha, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' }), children: createElement(EditorModal, { loading: false, isOpen: true, renderCompilation: () => createElement(View), ...props }) }));
/* eslint-enable react/no-children-prop */
const behind = { notebookId: 'a', path: reading.path };

it('keeps a zoomed compilation mounted, hidden, behind a note opened from it, and shows the same view again when the note closes', () => {
  mounts = 0;
  const { rerender } = render(modal({ note: reading }));
  const frame = screen.getByRole('dialog', { name: 'Compilation' });
  expect(frame.parentElement).not.toHaveAttribute('data-behind');
  rerender(modal({ note: alpha, behind }));
  expect(document.querySelector('[aria-label="Compilation"]')).toBe(frame);
  expect(frame.parentElement).toHaveAttribute('data-behind');
  expect(frame.parentElement).toHaveStyle({ visibility: 'hidden' });
  expect(screen.getByTestId('editor')).toBeTruthy();
  rerender(modal({ note: reading }));
  expect(screen.getByRole('dialog', { name: 'Compilation' })).toBe(frame);
  expect(frame.parentElement).not.toHaveAttribute('data-behind');
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(mounts).toBe(1);
});

it('keeps the workspace rail hidden once a note opened from a zoomed compilation closes', () => {
  const { rerender } = render(modal({ note: reading }));
  expect(screen.getByLabelText('rail').textContent).toBe('hidden');
  rerender(modal({ note: alpha, behind }));
  expect(screen.getByLabelText('rail').textContent).toBe('hidden');
  rerender(modal({ note: reading }));
  expect(screen.getByLabelText('rail').textContent).toBe('hidden');
  rerender(modal({ note: null, loading: false }));
  expect(screen.getByLabelText('rail').textContent).toBe('shown');
});

it('gives focus back to the control that opened the note when the compilation shows again', () => {
  const { rerender } = render(modal({ note: reading }));
  const opener = screen.getByRole('button', { name: 'Open Alpha' });
  opener.focus();
  expect(opener).toHaveFocus();
  rerender(modal({ note: alpha, behind }));
  (document.activeElement as HTMLElement | null)?.blur();
  expect(opener).not.toHaveFocus();
  rerender(modal({ note: reading }));
  expect(screen.getByRole('button', { name: 'Open Alpha' })).toHaveFocus();
});

it('shows a note that is still loading as a dialog of its own over the hidden compilation, so Escape cannot close the compilation behind it', () => {
  render(modal({ note: null, loading: true, behind }));
  expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2);
  expect(screen.getByRole('dialog', { name: 'Loading note…' })).toHaveAttribute('aria-busy', 'true');
});
