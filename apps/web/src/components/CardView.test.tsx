// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { CardView } from './CardView.js';
import { NOTE_DRAG_TYPE } from '../lib/note-drag.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';

afterEach(cleanup);

const noteOf = (path: string): NoteListItem => ({ id: path, path, notebookId: 'life', title: path, tags: [], metadata: {} });

const baseProps = { statuses: ['inbox'], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn() };

function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      data[type] = value;
    },
    getData: (type: string) => data[type] || '',
    effectAllowed: '',
  };
}

it('renders no zoom button and a non-draggable card without focusMode', () => {
  render(createElement(CardView, { ...baseProps, notes: [noteOf('notes/a.md')] }));
  expect(screen.queryByTitle('Open in zoom')).not.toBeInTheDocument();
  const card = screen.getByText('notes/a.md').closest('[draggable]')!;
  expect(card).toHaveAttribute('draggable', 'false');
});

it('shows a zoom button that calls onZoomNote without opening the note', () => {
  const onOpenNote = vi.fn();
  const onZoomNote = vi.fn();
  render(createElement(CardView, { ...baseProps, onOpenNote, notes: [noteOf('notes/a.md')], focusMode: { onZoomNote, canDrag: () => true } }));
  fireEvent.click(screen.getByTitle('Open in zoom'));
  expect(onZoomNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/a.md' }));
  expect(onOpenNote).not.toHaveBeenCalled();
});

it('makes a card draggable with the note-drag payload when canDrag is true', () => {
  render(createElement(CardView, { ...baseProps, notes: [noteOf('notes/a.md')], focusMode: { onZoomNote: vi.fn(), canDrag: () => true } }));
  const card = screen.getByText('notes/a.md').closest('[draggable]')!;
  expect(card).toHaveAttribute('draggable', 'true');
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/a.md');
  expect(dataTransfer.getData('text/plain')).toBe('notes/a.md');
});

it('leaves a card non-draggable when canDrag returns false', () => {
  render(createElement(CardView, { ...baseProps, notes: [noteOf('notes/a.md')], focusMode: { onZoomNote: vi.fn(), canDrag: () => false } }));
  const card = screen.getByText('notes/a.md').closest('[draggable]')!;
  expect(card).toHaveAttribute('draggable', 'false');
});

it('renders cards in a single strip row when strip is true', () => {
  const { container } = render(createElement(CardView, { ...baseProps, notes: [noteOf('notes/a.md'), noteOf('notes/b.md')], strip: true }));
  expect(container.querySelector('.note-card-strip')).toBeInTheDocument();
  expect(container.querySelectorAll('.note-card-strip-item').length).toBe(2);
});
