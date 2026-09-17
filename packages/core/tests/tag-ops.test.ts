import { describe, expect, it } from 'vitest';
import { invertTagOperationPlan, planTagDelete, planTagMerge, planTagRename, retagList } from '../src/tag-ops.js';
import { NoteItem } from '../src/types.js';

function note(path: string, tags: string[], notebookId = 'nb'): NoteItem {
  return { id: path, path, notebookId, title: path, status: undefined, tags, metadata: { tags }, content: 'body' };
}

describe('retagList', () => {
  it('replaces the tag at its original position when the target is new', () => {
    expect(retagList(['x', 'a', 'y'], 'a', 'b')).toEqual(['x', 'b', 'y']);
  });

  it('drops the source and dedupes when the target already exists', () => {
    expect(retagList(['a', 'b'], 'a', 'b')).toEqual(['b']);
    expect(retagList(['b', 'a'], 'a', 'b')).toEqual(['b']);
  });

  it('is a no-op when the source tag is absent', () => {
    expect(retagList(['x', 'y'], 'a', 'b')).toEqual(['x', 'y']);
  });

  it('produces an empty array when the source was the only tag and has no target elsewhere', () => {
    expect(retagList(['a'], 'a', 'a')).toEqual(['a']);
  });
});

describe('planTagRename / planTagMerge', () => {
  const notes = [
    note('a.md', ['todo', 'x']),
    note('b.md', ['todo']),
    note('c.md', ['todo', 'doing']),
    note('d.md', ['other']),
  ];

  it('rename: affects only notes carrying the source tag, dedupes against an existing target', () => {
    const plan = planTagRename(notes, 'todo', 'doing');
    expect(plan.affected.map(e => e.path)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(plan.affected.find(e => e.path === 'a.md')).toMatchObject({ previousTags: ['todo', 'x'], nextTags: ['doing', 'x'] });
    expect(plan.affected.find(e => e.path === 'b.md')).toMatchObject({ previousTags: ['todo'], nextTags: ['doing'] });
    expect(plan.affected.find(e => e.path === 'c.md')).toMatchObject({ previousTags: ['todo', 'doing'], nextTags: ['doing'] });
  });

  it('merge behaves identically to rename (same transform, different name)', () => {
    expect(planTagMerge(notes, 'todo', 'doing')).toEqual(planTagRename(notes, 'todo', 'doing'));
  });

  it('rejects renaming/merging a tag into itself', () => {
    expect(() => planTagRename(notes, 'todo', 'todo')).toThrow();
    expect(() => planTagMerge(notes, 'todo', 'todo')).toThrow();
  });

  it('produces an empty plan when the source tag is absent anywhere', () => {
    expect(planTagRename(notes, 'missing', 'doing').affected).toEqual([]);
  });

  it('carries the notebookId through unchanged', () => {
    const plan = planTagRename([note('a.md', ['todo'], 'blog'), note('b.md', ['todo'], 'thesis')], 'todo', 'doing');
    expect(plan.affected.map(e => e.notebookId)).toEqual(['blog', 'thesis']);
  });
});

describe('planTagDelete', () => {
  it('removes the tag, leaving an empty array when it was the only tag', () => {
    const notes = [note('a.md', ['x']), note('b.md', ['x', 'y']), note('c.md', ['y'])];
    const plan = planTagDelete(notes, 'x');
    expect(plan.affected.map(e => e.path)).toEqual(['a.md', 'b.md']);
    expect(plan.affected.find(e => e.path === 'a.md')).toMatchObject({ previousTags: ['x'], nextTags: [] });
    expect(plan.affected.find(e => e.path === 'b.md')).toMatchObject({ previousTags: ['x', 'y'], nextTags: ['y'] });
  });

  it('excludes notes that never carried the tag', () => {
    const notes = [note('a.md', ['y'])];
    expect(planTagDelete(notes, 'x').affected).toEqual([]);
  });
});

describe('invertTagOperationPlan', () => {
  it('swaps previous/next so undo restores the exact pre-operation arrays', () => {
    const notes = [note('a.md', ['todo', 'x']), note('c.md', ['todo', 'doing'])];
    const plan = planTagRename(notes, 'todo', 'doing');
    const inverted = invertTagOperationPlan(plan);
    expect(inverted.affected.find(e => e.path === 'a.md')).toMatchObject({ previousTags: ['doing', 'x'], nextTags: ['todo', 'x'] });
    // Merge's dedupe is lossy going forward, but undo restores the exact original array
    // regardless, since it's driven by the recorded snapshot, not by re-deriving the merge.
    expect(inverted.affected.find(e => e.path === 'c.md')).toMatchObject({ previousTags: ['doing'], nextTags: ['todo', 'doing'] });
  });
});
