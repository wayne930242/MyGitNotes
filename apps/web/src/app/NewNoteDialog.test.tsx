// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NewNoteDialog } from './NewNoteDialog.js';

afterEach(cleanup);

it('asks for no folder: a new note starts at the notebook root and moves from its editor', () => {
  render(<NewNoteDialog t={key => key} createError='' newNoteTitle='' onTitleChange={vi.fn()} onSubmit={vi.fn()} newNoteTemplates={[]} newNoteTemplateId='' onTemplateChange={vi.fn()} newNoteTags={[]} newNoteStatus='inbox' onStatusChange={vi.fn()} newNoteStatuses={['inbox']} onCancel={vi.fn()} />);
  expect(screen.getByText('createNote.noteTitle')).toBeTruthy();
  expect(screen.queryByText('createNote.folder')).toBeNull();
  expect(document.querySelector('#create-note-folder')).toBeNull();
});
