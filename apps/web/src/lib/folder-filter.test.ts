import { describe, expect, it } from 'vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { filterNotesByFolder, filterTasksByFolder, pathInFolder } from './folder-filter.js';
import type { TodoTask } from './todo-list.js';

function task(notePath: string): TodoTask {
  return { id: `${notePath}#0`, notePath, notebookId: 'nb', noteTitle: notePath, lineIndex: 0, lineText: '- [ ] Task', checked: false };
}

function note(path: string): NoteListItem {
  return { id: path, path, notebookId: 'nb', title: path, tags: [], metadata: {} };
}

describe('pathInFolder', () => {
  it('matches a note directly inside the folder', () => {
    expect(pathInFolder('example/projects/plan.md', 'example/projects')).toBe(true);
  });

  it('matches a note in a subfolder of the folder', () => {
    expect(pathInFolder('example/projects/2026/plan.md', 'example/projects')).toBe(true);
  });

  it('does not match a note in a sibling folder with a matching prefix', () => {
    expect(pathInFolder('example/projects-archive/plan.md', 'example/projects')).toBe(false);
  });

  it('does not match a note outside the folder', () => {
    expect(pathInFolder('example/inbox/plan.md', 'example/projects')).toBe(false);
  });
});

describe('filterTasksByFolder', () => {
  it('keeps only tasks whose note is in the folder or a subfolder', () => {
    const tasks = [task('example/projects/a.md'), task('example/projects/2026/b.md'), task('example/inbox/c.md')];
    expect(filterTasksByFolder(tasks, 'example/projects').map(t => t.notePath)).toEqual(['example/projects/a.md', 'example/projects/2026/b.md']);
  });
});

describe('filterNotesByFolder', () => {
  it('keeps only notes in the folder or a subfolder', () => {
    const notes = [note('example/projects/a.md'), note('example/inbox/c.md')];
    expect(filterNotesByFolder(notes, 'example/projects').map(n => n.path)).toEqual(['example/projects/a.md']);
  });
});
