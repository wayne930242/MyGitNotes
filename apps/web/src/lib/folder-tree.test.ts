import { describe, it, expect } from 'vitest';
import {
  getImmediateSubfolders,
  getImmediateNotes,
  getBreadcrumbs,
} from './folder-tree.js';
import { NoteItem, FolderItem } from './types.js';

describe('folder-tree', () => {
  it('keeps folder cards in the persisted sidebar order', () => {
    const ordered = [{ notebookId:'n', path:'a', title:'A', order:1 }, { notebookId:'n', path:'z', title:'Z', order:0 }];
    expect(getImmediateSubfolders([], ordered, 'n', 'notes/n', null).map(folder => folder.path)).toEqual(['z','a']);
  });
  const notes: NoteItem[] = [
    {
      id: '1',
      path: 'notes/root-note.md',
      notebookId: 'nb1',
      title: 'Root Note',
      tags: [],
      metadata: {},
      content: 'hello',
    },
    {
      id: '2',
      path: 'notes/projects/proj-overview.md',
      notebookId: 'nb1',
      title: 'Project Overview',
      tags: [],
      metadata: {},
      content: 'hello',
    },
    {
      id: '3',
      path: 'notes/projects/web/app.md',
      notebookId: 'nb1',
      title: 'Web App',
      tags: [],
      metadata: {},
      content: 'hello',
    },
    {
      id: '4',
      path: 'notes/projects/backend/api.md',
      notebookId: 'nb1',
      title: 'Backend API',
      tags: [],
      metadata: {},
      content: 'hello',
    },
    {
      id: '5',
      path: 'notes/personal/diary.md',
      notebookId: 'nb1',
      title: 'Diary',
      tags: [],
      metadata: {},
      content: 'hello',
    },
  ];

  const folders: FolderItem[] = [
    { notebookId: 'nb1', path: 'projects', title: 'Projects', order: 1 },
    { notebookId: 'nb1', path: 'projects/web', title: 'Web App Dev', order: 2 },
    { notebookId: 'nb1', path: 'personal', title: 'Personal Notes', order: 3 },
  ];

  it('lists immediate subfolders under All folders (null)', () => {
    const subfolders = getImmediateSubfolders(notes, folders, 'nb1', 'notes', null);
    expect(subfolders.map((s) => s.path)).toEqual(['projects', 'personal']);
    expect(subfolders.find((s) => s.path === 'projects')?.noteCount).toBe(3); // proj-overview, web/app, backend/api
    expect(subfolders.find((s) => s.path === 'personal')?.noteCount).toBe(1); // diary
  });

  it('lists immediate subfolders under a specific folder (projects)', () => {
    const subfolders = getImmediateSubfolders(notes, folders, 'nb1', 'notes', 'projects');
    expect(subfolders.map((s) => s.path)).toEqual(['projects/backend', 'projects/web']);
    expect(subfolders.find((s) => s.path === 'projects/backend')?.noteCount).toBe(1);
    expect(subfolders.find((s) => s.path === 'projects/web')?.title).toBe('Web App Dev');
  });

  it('extracts direct notes in root and in subfolders', () => {
    const rootNotes = getImmediateNotes(notes, 'notes', null);
    expect(rootNotes.map((n) => n.title)).toEqual(['Root Note']);

    const projectNotes = getImmediateNotes(notes, 'notes', 'projects');
    expect(projectNotes.map((n) => n.title)).toEqual(['Project Overview']);
  });

  it('generates breadcrumb segments accurately', () => {
    const rootBreadcrumbs = getBreadcrumbs(null, folders, 'nb1');
    expect(rootBreadcrumbs).toEqual([{ name: 'All folders', path: null }]);

    const nestedBreadcrumbs = getBreadcrumbs('projects/web', folders, 'nb1');
    expect(nestedBreadcrumbs).toEqual([
      { name: 'All folders', path: null },
      { name: 'Projects', path: 'projects' },
      { name: 'Web App Dev', path: 'projects/web' },
    ]);
  });
});
