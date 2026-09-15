import { describe, expect, it } from 'vitest';
import { insertNoteLink } from '../src/note-graph.js';
import { ScreenPageSchema, screenRowNotePaths } from '../src/screen-page.js';
import { extractNoteLinks } from '../src/note-graph.js';
import type { NoteItem } from '../src/types.js';

describe('graph editing contracts', () => {
  it('inserts a portable link at the caret and preserves surrounding text', () => {
    const content = 'before after';
    const path = 'notes/a/source.md', target = 'notes/b/a (b)#?.md';
    const result = insertNoteLink(content, path, target, 'Title [B]', 7);
    expect(result.content).toBe('before [Title \\[B\\]](../b/a%20%28b%29%23%3F.md)after');
    expect(extractNoteLinks(result.content, path, new Set([path, target]))).toEqual([target]);
  });
  it('appends without a caret, refuses self links, and does not duplicate a relation', () => {
    const result = insertNoteLink('A', 'notes/a.md', 'notes/b.md', 'B');
    expect(result.content).toBe('A\n\n[B](b.md)');
    expect(insertNoteLink(result.content, 'notes/a.md', 'notes/b.md', 'B').content).toBe(result.content);
    expect(insertNoteLink('A', 'notes/a.md', 'notes/a.md', 'A').content).toBe('A');
  });
  it('round trips graph lanes and layout while preserving old lanes', () => {
    const page = { version: 1, rows: [{ id: 'old', name: 'Old', view: 'small', kind: 'custom', items: [] },
      { id: 'graph', name: 'Graph', view: 'graph', kind: 'custom', items: [], graph: { nodes: [{ path: 'notes/a.md', x: 12, y: 20, width: 360, height: 300, expanded: true, pinned: true }] } }] };
    expect(ScreenPageSchema.parse(page)).toEqual(page);
    expect(ScreenPageSchema.safeParse({ ...page, rows: [{ ...page.rows[1], graph: { nodes: [{ path: '../bad', x: Infinity, y: 0 }] } }] }).success).toBe(false);
  });
  it('resolves lane notes consistently without expanding folder shortcuts or including assets', () => {
    const notes = [{ path: 'notes/a.md', notebookId: 'n', tags: ['x'], metadata: {}, status: 'draft' }, { path: 'notes/sub/b.md', notebookId: 'n', tags: [], metadata: {} }] as NoteItem[];
    expect(screenRowNotePaths({ id: 'r', name: 'R', view: 'graph', kind: 'custom', items: [{ id: 'a', kind: 'note', path: 'notes/a.md', notebookId: 'n' }, { id: 'f', kind: 'folder', path: 'notes/sub', notebookId: 'n' }] }, notes)).toEqual(['notes/a.md']);
    expect(screenRowNotePaths({ id: 'd', name: 'D', view: 'graph', kind: 'dynamic', source: { kind: 'folder', notebookId: 'n', path: 'notes', recursive: true } }, notes)).toEqual(['notes/a.md', 'notes/sub/b.md']);
  });
});
