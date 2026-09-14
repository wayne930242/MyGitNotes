import { describe, expect, it } from 'vitest';
import type { ScreenRow } from '@github-notes/core/screen-page';
import type { NotebookConfig } from '../lib/types.js';
import { createLaneNoteContext } from './ScreenPage.js';

describe('createLaneNoteContext', () => {
  const notebooks: NotebookConfig[] = [
    { id: 'nb-1', title: 'Main Notebook', root: 'notes/main' },
    { id: 'nb-2', title: 'Second Notebook', root: 'notes/secondary' },
  ];

  it('extracts tag context for tag dynamic lanes with notebookId', () => {
    const row: ScreenRow = {
      id: 'r1',
      name: 'Clues',
      view: 'small',
      kind: 'dynamic',
      source: { kind: 'tag', tag: 'clue', notebookId: 'nb-1' },
    };
    expect(createLaneNoteContext(row, notebooks)).toEqual({
      tag: 'clue',
      notebookId: 'nb-1',
    });
  });

  it('extracts tag context for cross-notebook tag dynamic lanes', () => {
    const row: ScreenRow = {
      id: 'r2',
      name: 'All Clues',
      view: 'small',
      kind: 'dynamic',
      source: { kind: 'tag', tag: 'clue' },
    };
    expect(createLaneNoteContext(row, notebooks)).toEqual({
      tag: 'clue',
      notebookId: undefined,
    });
  });

  it('extracts relative folder context for nested folder dynamic lanes', () => {
    const row: ScreenRow = {
      id: 'r3',
      name: 'Deep Folder',
      view: 'medium',
      kind: 'dynamic',
      source: { kind: 'folder', notebookId: 'nb-1', path: 'notes/main/campaign/sessions', recursive: true },
    };
    expect(createLaneNoteContext(row, notebooks)).toEqual({
      notebookId: 'nb-1',
      folder: 'campaign/sessions',
    });
  });

  it('extracts empty string folder context when folder is at notebook root', () => {
    const row: ScreenRow = {
      id: 'r4',
      name: 'Root Folder',
      view: 'thumbnail',
      kind: 'dynamic',
      source: { kind: 'folder', notebookId: 'nb-2', path: 'notes/secondary', recursive: false },
    };
    expect(createLaneNoteContext(row, notebooks)).toEqual({
      notebookId: 'nb-2',
      folder: '',
    });
  });

  it('returns null for custom lanes', () => {
    const row: ScreenRow = {
      id: 'r5',
      name: 'Pinned',
      view: 'small',
      kind: 'custom',
      items: [],
    };
    expect(createLaneNoteContext(row, notebooks)).toBeNull();
  });
});
