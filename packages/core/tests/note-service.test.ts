import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { prewarmNotebookScans, scanNotebookEntries, scanNotebookNotes, writeNoteFile } from '../src/note-service.js';

describe('writeNoteFile timestamp stamping', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-note-service-'));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('stamps created on a genuinely new note', () => {
    const note = writeNoteFile(repoRoot, 'notes/new-note.md', 'Body.', { title: 'New' }, 'example');
    expect(note.metadata.created).toBeDefined();
    expect(note.metadata.updated).toBeDefined();
  });

  it('does not invent created for a pre-existing file that predates this feature', () => {
    // Simulate a note written by an older version of the app, with no created/updated.
    const safePath = path.join(repoRoot, 'notes/old-note.md');
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, '---\ntitle: Old note\n---\n\nOriginal body.\n', 'utf-8');

    const edited = writeNoteFile(repoRoot, 'notes/old-note.md', 'Edited body.', { title: 'Old note' }, 'example');
    expect(edited.metadata.created).toBeUndefined();
    expect(edited.metadata.updated).toBeDefined();
  });

  it('preserves created across a second edit of a note it did create', () => {
    const first = writeNoteFile(repoRoot, 'notes/note.md', 'v1', { title: 'Note' }, 'example');
    const createdAt = first.metadata.created;
    const second = writeNoteFile(repoRoot, 'notes/note.md', 'v2', first.metadata, 'example');
    expect(second.metadata.created).toBe(createdAt);
  });

  it('scans .mdx notes alongside .md notes in notebook', () => {
    fs.mkdirSync(path.join(repoRoot, 'notes/example'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'notes/example/regular.md'), '---\ntitle: Regular\n---\nBody');
    fs.writeFileSync(path.join(repoRoot, 'notes/example/interactive.mdx'), '---\ntitle: Interactive MDX\n---\n<Component />');
    const notes = scanNotebookNotes(repoRoot, { id: 'example', title: 'Example', root: 'notes/example' });
    expect(notes.map(n => n.title).sort()).toEqual(['Interactive MDX', 'Regular']);
  });

  it('reuses unchanged parses across scans yet follows edits, additions and deletions', () => {
    const notebook = { id: 'example', title: 'Example', root: 'notes/example' };
    const dir = path.join(repoRoot, 'notes/example');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), '---\ntitle: A\ntags: [one]\n---\nBody A');
    fs.writeFileSync(path.join(dir, 'b.md'), '---\ntitle: B\n---\nBody B');
    const first = scanNotebookNotes(repoRoot, notebook);
    // A caller changing its result must not reach the next scan.
    const a = first.find(note => note.path.endsWith('a.md'))!;
    a.metadata.title = 'Changed';
    a.tags.push('two');
    expect(scanNotebookNotes(repoRoot, notebook).find(note => note.path.endsWith('a.md'))).toMatchObject({ title: 'A', tags: ['one'], metadata: { title: 'A' } });

    // Same size, so only the change times tell the edit apart.
    fs.writeFileSync(path.join(dir, 'a.md'), '---\ntitle: Z\ntags: [one]\n---\nBody Z');
    fs.rmSync(path.join(dir, 'b.md'));
    fs.writeFileSync(path.join(dir, 'c.md'), '---\ntitle: C\n---\nBody C');
    const next = scanNotebookNotes(repoRoot, notebook);
    expect(next.map(note => [note.title, note.content.trim()]).sort()).toEqual([['C', 'Body C'], ['Z', 'Body Z']]);
  });

  it('prewarms notebook scans in the background, letting other work run between batches', async () => {
    const notebook = { id: 'example', title: 'Example', root: 'notes/example' };
    const dir = path.join(repoRoot, 'notes/example');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(dir, `${name}.md`), `---\ntitle: ${name}\n---\nBody`);
    const order: string[] = [];
    setImmediate(() => order.push('other work'));
    const warm = prewarmNotebookScans(repoRoot, [notebook], 2).then(() => order.push('prewarmed'));
    expect(order).toEqual([]);
    await warm;
    expect(order).toEqual(['other work', 'prewarmed']);
    expect(scanNotebookEntries(repoRoot, notebook).map(note => note.title).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
