// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AddToOutlineDialog } from './AddToOutlineDialog.js';

const list = vi.hoisted(() => ({ current: { notes: [] as unknown[], uncommitted: [] as unknown[], loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} } }));
vi.mock('../lib/use-note-queries.js', () => ({ useNoteList: () => list.current }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

const source = { id: 's', path: 'notes/a/s.md', notebookId: 'a', title: 'Source', tags: [], metadata: {}, content: '' };
const outline = { id: 'o', path: 'notes/a/plan.outline.md', notebookId: 'a', title: 'Plan', tags: [], metadata: {} };
const dialog = (onChoose = vi.fn(async () => {})) => {
  render(createElement(AddToOutlineDialog, { source, busy: false, error: '', onChoose, onClose: () => {} }));
  return onChoose;
};

for (const notes of [[], [outline]]) {
  it(`offers New outline as the default destination, with no separate create button (${notes.length} outlines)`, () => {
    list.current = { ...list.current, notes };
    const onChoose = dialog();
    expect(screen.getByRole('combobox', { name: 'Destination outline' })).toHaveTextContent('New outline');
    expect(screen.queryByRole('button', { name: 'New outline' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open and insert' }));
    expect(onChoose).toHaveBeenCalledWith(null);
  });
}
