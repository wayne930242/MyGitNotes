// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NoteEditorToolbar } from './NoteEditorToolbar.js';

afterEach(cleanup);

const note = { id: 'a', path: 'notes/untitled.md', notebookId: 'a', title: 'Untitled', tags: [], metadata: {}, content: '# Untitled' };
const session = { title: 'Untitled', locked: false, isSaving: false, hasUnsavedChanges: false, content: note.content, copyState: 'idle', copyNote: vi.fn(), close: vi.fn() };
const toolbar = (onRename?: () => void) => createElement(NoteEditorToolbar, { frame: 'zoom', note, session: session as never, docPanel: { notePanel: null, lastNotePanel: { current: 'find' } } as never, isMarkdown: false, autoSave: true, readOnly: false, editorMode: 'live', setEditorMode: vi.fn(), showLineNumbers: false, toggleLineNumbers: vi.fn(), showFormatToolbar: false, onClose: vi.fn(), onRename });

it('renames from the title in zoom, with no Rename button among the controls', () => {
  const onRename = vi.fn();
  render(toolbar(onRename));
  fireEvent.click(screen.getByRole('button', { name: 'Untitled' }));
  expect(onRename).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
});

it('shows the title as plain text when the note cannot be renamed', () => {
  render(toolbar());
  expect(screen.getByText('Untitled').tagName).toBe('DIV');
});
