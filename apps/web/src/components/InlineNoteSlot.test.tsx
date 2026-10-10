// @vitest-environment jsdom
import { createElement, type ReactNode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { CompilationEditingProvider, useCompilationEditing } from '../lib/compilation-editing.js';
import { InlineNoteSlot, type InlineNoteSlotParts } from './InlineNoteSlot.js';

const flushEditors = vi.fn<(keys?: readonly string[]) => Promise<boolean>>();
const refreshNotes = vi.fn<() => Promise<void>>();
vi.mock('../lib/note-editing.js', () => ({ useNoteEditing: () => ({ flushEditors, refreshNotes }) }));
vi.mock('./NoteEditorHost.js', () => ({
  HostedNoteEditor: ({ path, claim, frame, onSession }: { path: string; claim?: boolean; frame: string; onSession?: (session: { content: string; title: string; dirty: boolean; locked: boolean; } | null) => void; }) => {
    useEffect(() => {
      onSession?.({ content: 'body', title: path === 'notes/a.md' ? 'Alpha, retitled' : 'Beta', dirty: false, locked: false });
      return () => onSession?.(null);
    }, [onSession, path]);
    return createElement('textarea', { 'aria-label': 'Note content', 'data-claim': String(claim), 'data-frame': frame, 'defaultValue': 'body' });
  },
}));

beforeEach(() => {
  flushEditors.mockReset().mockResolvedValue(true);
  refreshNotes.mockReset().mockResolvedValue();
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

const onOpenZoom = vi.fn();
beforeEach(() => onOpenZoom.mockClear());
const Slot = ({ slot, path, title, writable = true, layout = 'fill' }: { slot: string; path: string; title: string; writable?: boolean; layout?: 'grow' | 'fill'; }) =>
  createElement(InlineNoteSlot, {
    slot,
    notebookId: 'nb',
    path,
    title,
    writable,
    layout,
    reading: createElement('div', null, createElement('p', null, `${title} reads here`), createElement('a', { href: '#x' }, 'a link')),
    onOpenZoom,
    children: ({ controls, body, frameProps }: InlineNoteSlotParts) => createElement('article', { 'aria-label': `slot ${slot}`, ...frameProps }, createElement('header', null, controls), body),
  });
const Harness = ({ children }: { children: ReactNode; }) => createElement(CompilationEditingProvider, { value: useCompilationEditing() }, children);
const two = (props: { writable?: boolean; } = {}) => createElement(Harness, null, createElement(Slot, { slot: 'a', path: 'notes/a.md', title: 'Alpha', ...props }), createElement(Slot, { slot: 'b', path: 'notes/b.md', title: 'Beta', ...props }));
const frame = (slot: string) => screen.getByLabelText(`slot ${slot}`);
const click = (element: Element, pointerType = 'mouse') => {
  fireEvent.pointerDown(element, { pointerType });
  fireEvent.click(element, { pointerType });
};

it('offers Edit named after the note, and no control where the note cannot be edited', () => {
  const { rerender } = render(two());
  const edit = within(frame('a')).getByRole('button', { name: 'Edit Alpha' });
  expect(edit).toHaveTextContent('Edit');
  expect(edit).toHaveAttribute('title', 'Edit Alpha');
  rerender(two({ writable: false }));
  expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
});

it('turns the slot into the note\'s editor in place, focused at the start, with Done in its heading', async () => {
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  await waitFor(() => expect(frame('a')).toHaveAttribute('data-editing'));
  const editor = within(frame('a')).getByLabelText('Note content');
  expect(editor).toHaveAttribute('data-frame', 'compact');
  expect(editor).toHaveAttribute('data-claim', 'true');
  expect(within(frame('a')).getByRole('group', { name: 'Alpha, retitled' })).toHaveAttribute('data-layout', 'fill');
  await waitFor(() => expect(editor).toHaveFocus());
  expect((editor as HTMLTextAreaElement).selectionStart).toBe(0);
  expect(within(frame('a')).queryByText('Alpha reads here')).toBeNull();
  expect(frame('b')).not.toHaveAttribute('data-editing');
});

it('follows the editor\'s title while it edits (E10)', async () => {
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  expect(await within(frame('a')).findByRole('button', { name: 'Finish editing Alpha, retitled' })).toHaveTextContent('Done');
});

it('edits on a mouse or pen click of the body, but opens zoom for a touch tap, a link, a selection or a read-only note', async () => {
  render(two());
  click(screen.getByText('Alpha reads here'), 'touch');
  expect(onOpenZoom).toHaveBeenCalledTimes(1);
  expect(frame('a')).not.toHaveAttribute('data-editing');
  click(within(frame('a')).getByText('a link'), 'mouse');
  expect(onOpenZoom).toHaveBeenCalledTimes(1);
  expect(frame('a')).not.toHaveAttribute('data-editing');
  const range = document.createRange();
  range.selectNodeContents(screen.getByText('Alpha reads here'));
  window.getSelection()?.addRange(range);
  click(screen.getByText('Alpha reads here'));
  expect(frame('a')).not.toHaveAttribute('data-editing');
  window.getSelection()?.removeAllRanges();
  click(screen.getByText('Alpha reads here'), 'pen');
  await waitFor(() => expect(frame('a')).toHaveAttribute('data-editing'));
});

it('opens zoom for a mouse click on the body of a note that cannot be edited (E2)', () => {
  onOpenZoom.mockClear();
  render(two({ writable: false }));
  click(screen.getByText('Beta reads here'));
  expect(onOpenZoom).toHaveBeenCalledTimes(1);
  expect(frame('b')).not.toHaveAttribute('data-editing');
});

it('saves and returns to reading on Done, leaving focus on Edit', async () => {
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  fireEvent.click(await within(frame('a')).findByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(frame('a')).not.toHaveAttribute('data-editing'));
  expect(flushEditors).toHaveBeenCalledWith(['nb:notes/a.md']);
  expect(within(frame('a')).getByText('Alpha reads here')).toBeInTheDocument();
  expect(within(frame('a')).getByRole('button', { name: 'Edit Alpha' })).toHaveFocus();
});

it('leaves the slot on an Escape nothing in the editor wanted, and stops there (K2)', async () => {
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  const editor = await within(frame('a')).findByLabelText('Note content');
  await waitFor(() => expect(editor).toHaveFocus());
  fireEvent.keyDown(editor, { key: 'Escape' });
  await waitFor(() => expect(frame('a')).not.toHaveAttribute('data-editing'));
  expect(within(frame('a')).getByRole('button', { name: 'Edit Alpha' })).toHaveFocus();
  // The key ends at the slot: the zoomed compilation's own Escape listener never sees it, so a second Escape closes the compilation.
  expect(outer).not.toHaveBeenCalled();
  document.removeEventListener('keydown', outer);
});

it('keeps an Escape the editor used for itself, and one that confirms an IME composition', async () => {
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  const editor = await within(frame('a')).findByLabelText('Note content');
  editor.addEventListener('keydown', event => event.preventDefault(), { once: true });
  fireEvent.keyDown(editor, { key: 'Escape' });
  fireEvent.keyDown(editor, { key: 'Escape', isComposing: true });
  await act(async () => {});
  expect(frame('a')).toHaveAttribute('data-editing');
  expect(flushEditors).not.toHaveBeenCalled();
});

it('stays in edit mode when the note cannot be saved (E7)', async () => {
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  const done = await within(frame('a')).findByRole('button', { name: /^Finish editing/ });
  flushEditors.mockResolvedValue(false);
  fireEvent.click(done);
  await waitFor(() => expect(flushEditors).toHaveBeenCalled());
  await act(async () => {});
  expect(frame('a')).toHaveAttribute('data-editing');
  expect(within(frame('a')).getByLabelText('Note content')).toBeInTheDocument();
});

it('edits at most one slot at a time: opening another saves the first and moves editing (E6)', async () => {
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  await within(frame('a')).findByLabelText('Note content');
  fireEvent.click(within(frame('b')).getByRole('button', { name: 'Edit Beta' }));
  await waitFor(() => expect(frame('b')).toHaveAttribute('data-editing'));
  expect(flushEditors).toHaveBeenCalledWith(['nb:notes/a.md']);
  expect(frame('a')).not.toHaveAttribute('data-editing');
  expect(screen.getAllByLabelText('Note content')).toHaveLength(1);
});

it('keeps the first slot when saving it fails, so the second does not open', async () => {
  render(two());
  fireEvent.click(within(frame('a')).getByRole('button', { name: 'Edit Alpha' }));
  await within(frame('a')).findByLabelText('Note content');
  flushEditors.mockResolvedValue(false);
  fireEvent.click(within(frame('b')).getByRole('button', { name: 'Edit Beta' }));
  await waitFor(() => expect(flushEditors).toHaveBeenCalled());
  await act(async () => {});
  expect(frame('a')).toHaveAttribute('data-editing');
  expect(frame('b')).not.toHaveAttribute('data-editing');
});
