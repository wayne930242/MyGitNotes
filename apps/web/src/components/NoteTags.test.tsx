// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ListView } from './ListView.js';
import { CardView } from './CardView.js';
import type { NoteItem } from '../lib/types.js';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(cleanup);

const note = { path: 'a.md', notebookId: 'nb', title: 'A', content: '', status: 'todo', tags: ['alpha'], metadata: {}, mtime: 0 } as unknown as NoteItem;

const baseProps = () => ({
  notes: [note], statuses: ['todo'], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn(),
  tagActions: { allTags: ['alpha', 'beta'], onPreviewUsage: vi.fn().mockResolvedValue(1), onRename: vi.fn().mockResolvedValue(undefined), onMerge: vi.fn().mockResolvedValue(undefined), onDelete: vi.fn().mockResolvedValue(undefined) },
});

describe.each([['ListView', ListView], ['CardView', CardView]] as const)('%s tag actions', (_name, View) => {
  it('opens tag management from the chip without opening the note', async () => {
    const props = baseProps();
    render(createElement(View as never, props));
    fireEvent.click(screen.getByText('alpha'));
    const trigger = screen.getByRole('button', { name: /manage tag/i });
    trigger.focus();
    await act(async () => { fireEvent.keyDown(trigger, { key: 'Enter' }); });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /rename/i })); });
    const input = screen.getByRole('textbox');
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(props.onOpenNote).not.toHaveBeenCalled();
    expect(props.tagActions.onPreviewUsage).toHaveBeenCalledWith('alpha');
  });

  it('still opens the note from elsewhere in the item', () => {
    const props = baseProps();
    render(createElement(View as never, props));
    fireEvent.click(screen.getByText('A'));
    expect(props.onOpenNote).toHaveBeenCalledWith(note);
  });
});
