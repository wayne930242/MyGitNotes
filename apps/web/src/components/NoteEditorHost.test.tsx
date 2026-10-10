// @vitest-environment jsdom
import { createElement, forwardRef, Fragment, type ReactNode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteEditingProvider, useNoteEditing } from '../lib/note-editing.js';
import type { NoteEditorProps } from './NoteEditor.js';
import { HostedNoteEditor } from './NoteEditorHost.js';

const alpha = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: {}, content: '# Alpha\n\nBody.' };

vi.mock('../lib/use-note-queries.js', () => ({ useNoteLookup: () => ({ notes: [{ id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: {}, content: '# Alpha\n\nBody.' }], committed: [], loading: false, error: '' }) }));
vi.mock('./NoteEditor.js', () => ({
  NoteEditor: forwardRef<unknown, NoteEditorProps>(({ frame, note, onSession }, _ref) => {
    /* eslint-disable react-hooks/exhaustive-deps -- The test double reports one mounted session and its cleanup; prop refreshes are exercised independently of mounting. */
    useEffect(() => {
      onSession?.({ content: note.content, title: note.title, dirty: false, locked: false });
      return () => onSession?.(null);
    }, []);
    /* eslint-enable react-hooks/exhaustive-deps */
    return createElement('div', { 'data-testid': 'editor', 'data-frame': frame }, note.content);
  }),
}));

afterEach(cleanup);

let editing: ReturnType<typeof useNoteEditing>;
const Probe = () => {
  /* eslint-disable react/globals -- The test probe captures its hook result for assertions after React commits. */
  editing = useNoteEditing();
  /* eslint-enable react/globals */
  return null;
};
let flushEditors: ReturnType<typeof vi.fn<(keys?: readonly string[]) => Promise<boolean>>>;
beforeEach(() => {
  flushEditors = vi.fn(async () => true);
});

/* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
const provide = (...children: ReactNode[]) => createElement(NoteEditingProvider, { register: () => () => {}, flushEditors, refreshNotes: async () => {}, closeZoom: () => {}, addToFocus: () => undefined, editorProps: () => ({ statuses: [], onSave: async () => alpha, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' }), children: createElement(Fragment, null, createElement(Probe), ...children) });
/* eslint-enable react/no-children-prop */

const twoHosts = () => provide(createElement('section', { 'data-testid': 'pane' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'pane', active: true })), createElement('section', { 'data-testid': 'card' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'compact', active: false })));

it('mounts one editor for a note shown in two hosts and lets the other host claim it', async () => {
  render(twoHosts());
  expect(screen.getAllByTestId('editor')).toHaveLength(1);
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'pane');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open for editing elsewhere.');
  expect(screen.getByTestId('card').querySelector('h1')).toHaveTextContent('Alpha');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }));
  });
  expect(flushEditors).toHaveBeenCalledWith(['a:notes/a.md']);
  expect(screen.getAllByTestId('editor')).toHaveLength(1);
  expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'compact');
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open for editing elsewhere.');
});

it('keeps the owner when its pending edits cannot be saved', async () => {
  flushEditors.mockResolvedValue(false);
  render(twoHosts());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }));
  });
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toBeInTheDocument();
  expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toBeNull();
});

it('lends the owner editor to zoom and takes it back when zoom closes', () => {
  render(twoHosts());
  const slot = document.createElement('div');
  document.body.append(slot);
  act(() => editing.setZoom({ key: 'a:notes/a.md', borrowed: true, slot }));
  const editor = screen.getByTestId('editor');
  expect(editor).toHaveAttribute('data-frame', 'zoom');
  expect(slot.contains(editor)).toBe(true);
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open in zoom.');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open in zoom.');
  expect(screen.queryByRole('button', { name: 'Edit here' })).toBeNull();

  act(() => editing.setZoom(null));
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'pane');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open for editing elsewhere.');
  slot.remove();
});

it('shows every host as open in zoom while zoom runs its own editor', () => {
  render(twoHosts());
  act(() => editing.setZoom({ key: 'a:notes/a.md', borrowed: false, slot: null }));
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open in zoom.');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open in zoom.');
});

const claimingCard = () => provide(createElement('section', { 'data-testid': 'pane' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'pane', active: true })), createElement('section', { 'data-testid': 'card' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'compact', active: false, claim: true })));

it('takes the editor from its owner when mounted to claim it, saving the owner first', async () => {
  render(claimingCard());
  await waitFor(() => expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'compact'));
  expect(flushEditors).toHaveBeenCalledWith(['a:notes/a.md']);
  expect(screen.getAllByTestId('editor')).toHaveLength(1);
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open for editing elsewhere.');
  expect(flushEditors).toHaveBeenCalledTimes(1);
});

it('claims nothing when it is the first host of the note', async () => {
  render(provide(createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'compact', active: false, claim: true })));
  await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
  expect(flushEditors).not.toHaveBeenCalled();
});

it('falls back to the preview with its Edit here button when the claim fails', async () => {
  flushEditors.mockResolvedValue(false);
  render(claimingCard());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit here' })).toBeInTheDocument());
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toBeInTheDocument();
  expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toBeNull();
});

it('shows the preview with its Edit here button, not the loading status, once another host takes over a note it owned from the start', async () => {
  render(provide(createElement('section', { 'data-testid': 'card' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'compact', active: false, claim: true })), createElement('section', { 'data-testid': 'pane' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'pane', active: true }))));
  await waitFor(() => expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toBeInTheDocument());
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open for editing elsewhere.');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }));
  });
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toBeInTheDocument();
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open for editing elsewhere.');
  expect(screen.getByTestId('card')).not.toHaveTextContent('Loading note');
  expect(within(screen.getByTestId('card')).getByRole('button', { name: 'Edit here' })).toBeInTheDocument();
});
