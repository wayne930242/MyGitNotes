import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { editableFile, type FileSnapshot, managedNotebook, planFileChange } from '../src/file-manager.js';
import { createStudyNote, STUDY_FILE } from '../src/study.js';
import { SCREEN_PAGE_FILE } from '../src/screen-page.js';
import { assetHash } from '../src/assets.js';

function fixture(): FileSnapshot {
  const note = createStudyNote({ notebookId: 'a', path: 'notes/a/one/note.md', title: 'Note', content: '# Note', metadata: {} });
  return { notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }, { id: 'b', title: 'B', root: 'notes/b' }], directories: ['notes/a', 'notes/a/one', 'notes/a/two', 'notes/a/one/child', 'notes/b'], protectedPaths: [], files: new Map([['notes/a/one/note.md', Buffer.from('---\ncustom: keep\n---\n# Note\n\n![image](image.png)\n[other](../two/other.md)\n')], ['notes/a/one/image.png', Buffer.from([137, 80, 78, 71, 0, 255])], ['notes/a/two/other.md', Buffer.from('[note](../one/note.md#heading)\n![image](/api/files/raw?notebookId=a&path=notes%2Fa%2Fone%2Fimage.png)\n')], ['notes/a/.hidden.json', Buffer.from('{"keep":true}\r\n')], ['notes/a/one/_dir.yml', Buffer.from('title: One\ncustom: preserve\n')], ['notes/a/two/_dir.yml', Buffer.from('title: Two\ncustom: destination\n')], [STUDY_FILE, Buffer.from(YAML.stringify({ version: 1, notes: [note], events: [] }))], [SCREEN_PAGE_FILE, Buffer.from(YAML.stringify({ version: 2, rows: [{ id: 'row', notebookId: 'a', kind: 'custom', name: 'Row', view: 'small', items: [{ id: 'note', kind: 'note', notebookId: 'a', path: 'notes/a/one/note.md' }, { id: 'image', kind: 'asset', notebookId: 'a', path: 'notes/a/one/image.png' }] }] }))]]) };
}
describe('file planning', () => {
  it('moves a directory with binary files, rewrites references and preserves study identities', () => {
    const before = fixture(), after = planFileChange(before, { kind: 'move', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/two/renamed' });
    expect(after.files.has('notes/a/one/note.md')).toBe(false);
    expect(assetHash(after.files.get('notes/a/two/renamed/image.png')!)).toBe(assetHash(before.files.get('notes/a/one/image.png')!));
    expect(after.files.get('notes/a/two/renamed/note.md')!.toString()).toContain('[other](../other.md)');
    expect(after.files.get('notes/a/two/renamed/note.md')!.toString()).toContain('custom: keep');
    expect(after.files.get('notes/a/two/other.md')!.toString()).toContain('[note](renamed/note.md#heading)');
    expect(after.files.get('notes/a/two/other.md')!.toString()).toContain('path=notes%2Fa%2Ftwo%2Frenamed%2Fimage.png');
    const studyBefore = YAML.parse(before.files.get(STUDY_FILE)!.toString()), studyAfter = YAML.parse(after.files.get(STUDY_FILE)!.toString());
    expect(studyAfter).toEqual({ ...studyBefore, notes: studyBefore.notes.map((note: any) => ({ ...note, path: 'notes/a/two/renamed/note.md' })) });
    const screen = YAML.parse(after.files.get(SCREEN_PAGE_FILE)!.toString());
    expect(screen.rows[0].items.map((item: any) => item.path)).toEqual(['notes/a/two/renamed/note.md', 'notes/a/two/renamed/image.png']);
    expect(before.files.has('notes/a/one/note.md')).toBe(true);
  });
  it('moves one note and updates its outbound links', () => {
    const after = planFileChange(fixture(), { kind: 'move', notebookId: 'a', path: 'notes/a/one/note.md', destination: 'notes/a/two/renamed.md' });
    expect(after.files.get('notes/a/two/renamed.md')!.toString()).toContain('![image](../one/image.png)');
  });
  it('creates actual empty text, writes raw text and preserves unknown folder metadata', () => {
    const empty = planFileChange(fixture(), { kind: 'create', notebookId: 'a', path: 'notes/a/blank.json' });
    expect(empty.files.get('notes/a/blank.json')!.length).toBe(0);
    const updated = planFileChange(empty, { kind: 'write', notebookId: 'a', path: 'notes/a/blank.json', content: '{"x":1}\r\n' });
    expect(updated.files.get('notes/a/blank.json')!.toString()).toBe('{"x":1}\r\n');
    const metadata = planFileChange(updated, { kind: 'metadata', notebookId: 'a', path: 'notes/a/one', title: 'New', description: 'Details', order: 2 });
    expect(YAML.parse(metadata.files.get('notes/a/one/_dir.yml')!.toString())).toEqual({ title: 'New', custom: 'preserve', description: 'Details', order: 2 });
  });
  it('removes a directory while preserving contents and destination metadata', () => {
    const before = fixture(), after = planFileChange(before, { kind: 'remove-directory', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/two' });
    expect(after.files.get('notes/a/two/_dir.yml')).toEqual(before.files.get('notes/a/two/_dir.yml'));
    expect(after.files.get('notes/a/two/image.png')).toEqual(before.files.get('notes/a/one/image.png'));
    expect(after.directories).toContain('notes/a/two/child');
    expect(after.directories).not.toContain('notes/a/one');
  });
  it.each(['notes/a/../escape', 'notes/b/file.md', 'notes/a/.git/config', 'notes/a/AGENTS.md', 'notes/a/docs/agent/a.md'])('rejects invalid targets: %s', path => {
    expect(() => planFileChange(fixture(), { kind: 'create', notebookId: 'a', path })).toThrow();
  });
  it('rejects collisions, descendant moves, protected children and binary text writes', () => {
    const before = fixture();
    expect(() => planFileChange(before, { kind: 'move', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/two' })).toThrow('already exists');
    expect(() => planFileChange(before, { kind: 'move', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/one/child/new' })).toThrow('outside');
    expect(() => planFileChange({ ...before, protectedPaths: ['notes/a/one/link'] }, { kind: 'move', notebookId: 'a', path: 'notes/a/one', destination: 'notes/a/new' })).toThrow('protected');
    expect(() => planFileChange(before, { kind: 'write', notebookId: 'a', path: 'notes/a/one/image.png', content: 'overwrite' })).toThrow('UTF-8');
  });
  it('recognizes UTF-8 including empty files and BOM, while preserving binary classification', () => {
    expect(managedNotebook('notes/a/.hidden.json', fixture().notebooks)?.id).toBe('a');
    expect(editableFile('empty', Buffer.alloc(0))).toBe('');
    expect(editableFile('file.txt', Buffer.from('\ufeff文字\r\n'))).toBe('\ufeff文字\r\n');
    expect(editableFile('file.txt', Buffer.from([255, 254, 0, 4]))).toBeUndefined();
    expect(editableFile('file.pdf', Buffer.from('%PDF text'))).toBeUndefined();
  });
  it('recognizes files under pathAliases target paths in managedNotebook', () => {
    const notebooks = [{ id: 'blog', title: 'Blog', root: 'blog/src/content/posts', pathAliases: { '@/*': 'blog/src/*' } }];
    expect(managedNotebook('blog/src/assets/images/photo.png', notebooks)?.id).toBe('blog');
  });
});
