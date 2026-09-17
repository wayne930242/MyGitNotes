import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { scanNotebookNotes, writeNoteFile } from '../src/note-service.js';

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
});
