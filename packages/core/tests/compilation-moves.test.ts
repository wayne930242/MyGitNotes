import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { type FileSnapshot, planFileChange } from '../src/file-manager.js';
import { type FolderSnapshot, planFolderChange } from '../src/folder-plan.js';

const compilation = `version: 1
id: reading
title: Reading
arrangement: lane
items:
  - { id: n1, kind: note, path: notes/a/one/note.md }
  - { id: n2, kind: note, path: notes/a/two/other.md }
  - { id: f1, kind: folder, path: notes/a/one }
  - { id: v1, kind: youtube, videoId: dQw4w9WgXcQ }
graph:
  nodes:
    - { path: notes/a/one/note.md, x: 0, y: 0 }
`;
const dynamic = 'version: 1\nid: live\ntitle: Live\narrangement: stack\nsource: { kind: folder, path: notes/a/one, recursive: true }\n';
const notebooks = [{ id: 'a', title: 'A', root: 'notes/a' }];

const fileSnapshot = (): FileSnapshot => ({ notebooks, directories: ['notes/a', 'notes/a/one', 'notes/a/two'], protectedPaths: [], files: new Map([['notes/a/one/note.md', Buffer.from('# Note\n')], ['notes/a/two/other.md', Buffer.from('# Other\n')], ['notes/a/reading.compilation.yml', Buffer.from(compilation)], ['notes/a/two/live.compilation.yml', Buffer.from(dynamic)]]) });
const folderSnapshot = (): FolderSnapshot => ({ notebooks, directories: ['notes/a', 'notes/a/one', 'notes/a/two'], protectedPaths: [], files: new Map([['notes/a/one/note.md', '# Note\n'], ['notes/a/two/other.md', '# Other\n'], ['notes/a/reading.compilation.yml', compilation], ['notes/a/two/live.compilation.yml', dynamic]]) });
const pinned = (raw: string | Buffer) => YAML.parse(String(raw)).items.map((item: { path?: string; }) => item.path);

describe('pinned references follow a file move', () => {
  it('rewrites pinned notes, folder items and graph nodes when a note moves', () => {
    const after = planFileChange(fileSnapshot(), { kind: 'move', notebookId: 'a', path: 'notes/a/one/note.md', destination: 'notes/a/two/renamed.md' });
    const text = after.files.get('notes/a/reading.compilation.yml')!.toString();
    expect(pinned(text)).toEqual(['notes/a/two/renamed.md', 'notes/a/two/other.md', 'notes/a/one', undefined]);
    expect(YAML.parse(text).graph.nodes[0].path).toBe('notes/a/two/renamed.md');
    expect(YAML.parse(text).items[3]).toMatchObject({ kind: 'youtube', videoId: 'dQw4w9WgXcQ' });
  });
  it('rewrites a folder item and a folder source when the folder is renamed, and follows a compilation inside it', () => {
    const after = planFileChange(fileSnapshot(), { kind: 'move', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/renamed' });
    expect(pinned(after.files.get('notes/a/reading.compilation.yml')!)).toEqual(['notes/a/renamed/note.md', 'notes/a/two/other.md', 'notes/a/renamed', undefined]);
    expect(YAML.parse(after.files.get('notes/a/two/live.compilation.yml')!.toString()).source.path).toBe('notes/a/renamed');
  });
  it('moves the compilation file itself without touching what it names', () => {
    const after = planFileChange(fileSnapshot(), { kind: 'move', notebookId: 'a', path: 'notes/a/reading.compilation.yml', destination: 'notes/a/one/reading.compilation.yml' });
    expect(after.files.has('notes/a/reading.compilation.yml')).toBe(false);
    expect(after.files.get('notes/a/one/reading.compilation.yml')!.toString()).toBe(compilation);
  });
  it('leaves a compilation whose references did not move byte for byte', () => {
    const after = planFileChange(fileSnapshot(), { kind: 'move', notebookId: 'a', path: 'notes/a/two/other.md', destination: 'notes/a/two/again.md' });
    expect(after.files.get('notes/a/two/live.compilation.yml')!.toString()).toBe(dynamic);
    expect(pinned(after.files.get('notes/a/reading.compilation.yml')!)[1]).toBe('notes/a/two/again.md');
  });
  it('keeps the legacy stack token when a move rewrites the compilation', () => {
    const after = planFileChange(fileSnapshot(), { kind: 'move', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/renamed' });
    const text = after.files.get('notes/a/two/live.compilation.yml')!.toString();
    expect(YAML.parse(text)).toMatchObject({ arrangement: 'stack', source: { path: 'notes/a/renamed' } });
  });
  it('rewrites pinned references when a folder is moved or its contents are folded into the parent', () => {
    const moved = planFolderChange(folderSnapshot(), { kind: 'move', notebookId: 'a', path: 'one', parent: 'two' });
    expect(pinned(moved.files.get('notes/a/reading.compilation.yml')!)).toEqual(['notes/a/two/one/note.md', 'notes/a/two/other.md', 'notes/a/two/one', undefined]);
    expect(YAML.parse(moved.files.get('notes/a/two/live.compilation.yml')!).source.path).toBe('notes/a/two/one');
    const removed = planFolderChange(folderSnapshot(), { kind: 'delete', notebookId: 'a', path: 'one', destination: '' });
    expect(pinned(removed.files.get('notes/a/reading.compilation.yml')!)[0]).toBe('notes/a/note.md');
  });
  it('leaves an unreadable compilation alone', () => {
    const snapshot = folderSnapshot();
    snapshot.files.set('notes/a/bad.compilation.yml', 'items: {');
    expect(planFolderChange(snapshot, { kind: 'move', notebookId: 'a', path: 'one', parent: 'two' }).files.get('notes/a/bad.compilation.yml')).toBe('items: {');
  });
});
