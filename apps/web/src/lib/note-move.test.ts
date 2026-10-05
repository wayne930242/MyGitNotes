import { describe, expect, it } from 'vitest';
import { noteFolder, noteStem, noteSuffix, planNoteMove, renamedPath, retitle } from './note-move.js';
import type { WorkingNote } from './working-notes.js';

const note = (path: string) => ({ id: 'a', path, notebookId: 'nb', title: 'A', content: '', metadata: {}, tags: [] });
const draft = (path: string, committed: boolean): WorkingNote => ({ note: note(path), base: committed ? note(path) : null });

describe('noteFolder', () => {
  it('names the folder relative to the notebook root, and null at the root', () => {
    expect(noteFolder('notes/a.md', 'notes')).toBeNull();
    expect(noteFolder('notes/work/plans/a.md', 'notes')).toBe('work/plans');
    expect(noteFolder('notes/work/a.md', 'notes/')).toBe('work');
  });
});

describe('planNoteMove', () => {
  it('moves a never-committed remote draft under its new path, without a file operation', () => {
    expect(planNoteMove('notes/a.md', 'notes', 'work', draft('notes/a.md', false))).toMatchObject({ kind: 'draft', destination: 'notes/work/a.md' });
  });

  it('moves a committed note as a file, even while it has a draft', () => {
    expect(planNoteMove('notes/a.md', 'notes', 'work', draft('notes/a.md', true))).toEqual({ kind: 'file', destination: 'notes/work/a.md' });
    expect(planNoteMove('notes/work/a.md', 'notes', null, undefined)).toEqual({ kind: 'file', destination: 'notes/a.md' });
  });

  it('does nothing when the note already sits in that folder', () => {
    expect(planNoteMove('notes/work/a.md', 'notes', 'work', undefined)).toEqual({ kind: 'none' });
  });
});

describe('renaming', () => {
  it('keeps the folder and the kind suffix, and names the file after the title', () => {
    expect(renamedPath('notes/work/untitled.md', '閱讀 筆記：第一章')).toBe('notes/work/閱讀-筆記-第一章.md');
    expect(renamedPath('notes/untitled-2.outline.md', 'Q4 Plan')).toBe('notes/q4-plan.outline.md');
    expect(renamedPath('notes/untitled.compilation.yml', 'Reading list')).toBe('notes/reading-list.compilation.yml');
    expect(noteSuffix('notes/a')).toBe('');
    expect(noteStem('!!!')).toBe('');
  });

  it('retitles through the heading that names a note, or the frontmatter title where there is one', () => {
    expect(retitle('# Untitled\n\nBody.\n', { status: 'inbox' }, 'Ideas', false)).toEqual({ content: '# Ideas\n\nBody.\n', metadata: { status: 'inbox' } });
    expect(retitle('# Untitled\n', { title: 'Untitled' }, 'Ideas', false)).toEqual({ content: '# Untitled\n', metadata: { title: 'Ideas' } });
    // A template's note carries both: the heading follows the title it repeated, and a different heading stays.
    expect(retitle('# Untitled\n\nBody.\n', { title: 'Untitled' }, 'Ideas', false, 'Untitled')).toEqual({ content: '# Ideas\n\nBody.\n', metadata: { title: 'Ideas' } });
    expect(retitle('# Chapter one\n', { title: 'Untitled' }, 'Ideas', false, 'Untitled')).toEqual({ content: '# Chapter one\n', metadata: { title: 'Ideas' } });
    expect(retitle('Just text.\n', {}, 'Ideas', false)).toEqual({ content: 'Just text.\n', metadata: { title: 'Ideas' } });
    expect(retitle('- # not a heading\n', {}, 'Plan', true)).toEqual({ content: '- # not a heading\n', metadata: { title: 'Plan' } });
  });
});
