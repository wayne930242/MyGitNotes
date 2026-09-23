// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { expect, it } from 'vitest';
import { useNoteSelection } from './useNoteSelection.js';

const note = { path: 'notes/life/one.md', notebookId: 'life' } as NoteListItem;

it('clears a selection when the browse filter changes', () => {
  const { result, rerender } = renderHook(({ scopeKey }) => useNoteSelection({ displayedNotes: [note], viewMode: 'flat', selectedNotebookId: 'life', scopeKey }), { initialProps: { scopeKey: '/' } });
  act(() => result.current.toggleSelect(note));
  expect(result.current.selectedNotes).toEqual([note]);

  rerender({ scopeKey: '/?q=other' });
  expect(result.current.selectedNotes).toEqual([]);

  rerender({ scopeKey: '/' });
  expect(result.current.selectedNotes).toEqual([]);
});
