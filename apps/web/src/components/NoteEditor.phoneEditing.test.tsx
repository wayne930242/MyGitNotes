// @vitest-environment jsdom
import { createElement, forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelProvider } from '../lib/panel-context.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorHandle, type NoteEditorProps } from './NoteEditor.js';

const inserted: string[] = [];
vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: () => null,
  MarkdownEditor: forwardRef<unknown, { content: string; readOnly: boolean; }>(({ content, readOnly }, ref) => {
    // The real editor drops an insert while it is read-only.
    useImperativeHandle(ref, () => ({ insert: (text: string) => !readOnly && inserted.push(text) }), [readOnly]);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, onChange: () => {} });
  }),
}));

let phone = true;
beforeEach(() => {
  phone = true;
  inserted.length = 0;
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? phone : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps> = {}) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', onClose: () => {}, ...props } as NoteEditorProps));
const content = () => screen.getByLabelText('Note content') as HTMLTextAreaElement;

it('opens a note read-only on a phone until Edit is pressed, and Done returns to reading', () => {
  render(editor());
  expect(content().readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(content().readOnly).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(content().readOnly).toBe(true);
});

it('keeps tablets and desktops editable without the toggle', () => {
  phone = false;
  render(editor());
  expect(content().readOnly).toBe(false);
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});

it('offers no toggle when the note cannot be edited', () => {
  render(editor({ readOnly: true }));
  expect(content().readOnly).toBe(true);
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});

it('switches to editing for an insert made while reading, instead of dropping it', async () => {
  const ref = { current: null as NoteEditorHandle | null };
  render(createElement(PanelProvider, null, createElement(NoteEditor, { ref, note, frame: 'zoom', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', onClose: () => {} } as NoteEditorProps)));
  await act(async () => {
    ref.current?.insert('[[Beta]]');
  });
  expect(content().readOnly).toBe(false);
  expect(inserted).toEqual(['[[Beta]]']);
});
