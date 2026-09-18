// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ListView } from './ListView.js';
import { NOTE_DRAG_TYPE } from '../lib/note-drag.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';

afterEach(cleanup);

const noteOf = (path: string): NoteListItem => ({ id: path, path, notebookId: 'life', title: `Title: ${path}`, tags: [], metadata: {} });

const baseProps = {
  statuses: ['inbox'],
  onOpenNote: vi.fn(),
  onDeleteNote: vi.fn(),
  onUpdateNoteStatus: vi.fn(),
  onNewNote: vi.fn(),
};

function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => { data[type] = value; },
    getData: (type: string) => data[type] || '',
    effectAllowed: '',
    _data: data,
  };
}

it('renders no zoom button and non-draggable rows without focusMode', () => {
  render(createElement(ListView, { ...baseProps, notes: [noteOf('notes/a.md')] }));
  expect(screen.queryByTitle('Open in zoom')).not.toBeInTheDocument();
  const row = screen.getByText('Title: notes/a.md').closest('tr')!;
  expect(row).toHaveAttribute('draggable', 'false');
});

it('shows a zoom button that calls onZoomNote without opening the note', () => {
  const onOpenNote = vi.fn();
  const onZoomNote = vi.fn();
  render(createElement(ListView, {
    ...baseProps, onOpenNote, notes: [noteOf('notes/a.md')],
    focusMode: { onZoomNote, canDrag: () => true },
  }));
  fireEvent.click(screen.getByTitle('Open in zoom'));
  expect(onZoomNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/a.md' }));
  expect(onOpenNote).not.toHaveBeenCalled();
});

it('makes a row draggable with the note-drag payload when canDrag is true', () => {
  render(createElement(ListView, {
    ...baseProps, notes: [noteOf('notes/a.md')],
    focusMode: { onZoomNote: vi.fn(), canDrag: () => true },
  }));
  const row = screen.getByText('Title: notes/a.md').closest('tr')!;
  expect(row).toHaveAttribute('draggable', 'true');
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(row, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/a.md');
  expect(dataTransfer.getData('text/plain')).toBe('notes/a.md');
});

it('leaves a row non-draggable when canDrag returns false', () => {
  render(createElement(ListView, {
    ...baseProps, notes: [noteOf('notes/a.md')],
    focusMode: { onZoomNote: vi.fn(), canDrag: () => false },
  }));
  const row = screen.getByText('Title: notes/a.md').closest('tr')!;
  expect(row).toHaveAttribute('draggable', 'false');
});

it('marks the note list compact via data-compact', () => {
  const { container } = render(createElement(ListView, { ...baseProps, notes: [noteOf('notes/a.md')], compact: true }));
  expect(container.querySelector('.note-list')).toHaveAttribute('data-compact', 'true');
});
