import { describe, expect, it } from 'vitest';
import { replaceFileTags } from './note-file.js';
import YAML from 'yaml';
import { applyCompilationMetadata, compilationCopyPath, compilationFields, type CompilationFile, compilationFile, compilationNotes, compilationRow, compilationSlug, copyCompilation, isCompilationPath, moveCompilationItem, parseCompilation, parseYouTubeUrl, relocateCompilation, serializeCompilation, uniqueCompilationPath } from './compilation.js';

const custom = `version: 1
id: reading-queue
title: Reading queue
arrangement: lane
size: medium
tags: [reading]
status: working
items:
  - { id: a1, kind: note, path: notes/one/a.md }
  - { id: v1, kind: youtube, videoId: dQw4w9WgXcQ, start: 0, title: Optional }
  - { id: f1, kind: folder, path: notes/one/sub }
`;
const dynamic = `version: 1
id: clues
title: Clues
arrangement: stack
source:
  kind: tag
  tag: clue
sort: { field: updated, order: desc }
`;
const legacyStack = dynamic;
const book = dynamic.replace('arrangement: stack', 'arrangement: book');
const owner = { notebookId: 'one', path: 'notes/one/reading.compilation.yml' };

describe('compilation file', () => {
  it('parses a custom and a dynamic compilation and ties items to the notebook', () => {
    const file = parseCompilation(custom, 'notes/one');
    expect(file).toMatchObject({ id: 'reading-queue', title: 'Reading queue', arrangement: 'lane', size: 'medium', tags: ['reading'], status: 'working' });
    expect(compilationRow(file, owner)).toMatchObject({ kind: 'custom', view: 'medium', notebookId: 'one', path: owner.path, items: [{ id: 'a1', kind: 'note', notebookId: 'one', path: 'notes/one/a.md' }, { id: 'v1', kind: 'youtube', videoId: 'dQw4w9WgXcQ' }, { id: 'f1', kind: 'folder', notebookId: 'one' }] });
    const row = compilationRow(parseCompilation(dynamic, 'notes/one'), owner);
    expect(row).toMatchObject({ kind: 'dynamic', view: 'book', source: { kind: 'tag', tag: 'clue', notebookId: 'one' }, sort: { field: 'updated', order: 'desc' } });
  });
  it('defaults a lane without a size to small and folder sources to recursive', () => {
    const file = parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/one/sub }\n');
    expect(compilationRow(file, owner)).toMatchObject({ view: 'small', source: { kind: 'folder', recursive: true } });
  });
  it('round-trips through the lane model without changing the file', () => {
    for (const raw of [custom, dynamic]) {
      const file = parseCompilation(raw, 'notes/one');
      expect(compilationFile(compilationRow(file, owner))).toEqual(file);
      expect(parseCompilation(serializeCompilation(file), 'notes/one')).toEqual(file);
    }
    const graph = parseCompilation('version: 1\nid: g\ntitle: G\narrangement: graph\nitems: []\ngraph: { nodes: [{ path: notes/one/a.md, x: 1, y: 2, expanded: true }] }\n');
    expect(compilationFile(compilationRow(graph, owner))).toEqual(graph);
  });
  it('keeps the lane size while the compilation is a book, so switching back restores it', () => {
    const row = compilationRow(parseCompilation(custom, 'notes/one'), owner);
    const booked = compilationFile({ ...row, view: 'book' });
    expect(booked).toMatchObject({ arrangement: 'book', size: 'medium' });
    expect(compilationRow(booked, owner).view).toBe('book');
    expect(compilationFile({ ...compilationRow(booked, owner), view: 'medium' })).toMatchObject({ arrangement: 'lane', size: 'medium' });
  });
  it('reads the legacy stack token as a book and writes it as book', () => {
    const file = parseCompilation(legacyStack, 'notes/one');
    expect(file.arrangement).toBe('book');
    expect(parseCompilation(book, 'notes/one')).toEqual(file);
    expect(compilationRow(file, owner).view).toBe('book');
    expect(YAML.parse(serializeCompilation(file)).arrangement).toBe('book');
    expect(serializeCompilation(file)).not.toContain('stack');
    expect(YAML.parse(serializeCompilation(compilationFile(compilationRow(file, owner)))).arrangement).toBe('book');
    expect(() => parseCompilation(legacyStack.replace('arrangement: stack', 'arrangement: carousel'))).toThrow('arrangement');
  });
  it('writes a legacy stack file as book when the compilation itself is copied, and the version stays 1', () => {
    const copy = copyCompilation(parseCompilation(legacyStack, 'notes/one'), []);
    expect(YAML.parse(serializeCompilation(copy))).toMatchObject({ version: 1, arrangement: 'book' });
  });
  it('rejects a file that does not hold exactly one of items and source, or sorts pinned items', () => {
    for (const body of ['', 'items: []\nsource: { kind: tag, tag: t }', 'items: []\nsort: { field: title, order: asc }']) {
      expect(() => parseCompilation(`version: 1\nid: x\ntitle: X\narrangement: lane\n${body}\n`)).toThrow(/items|sort/);
    }
  });
  it('keeps a manual order on a dynamic compilation through the lane model and the file', () => {
    const raw = `version: 1\nid: m\ntitle: M\narrangement: lane\nsize: small\nsource: { kind: folder, path: notes/one/sub }\nsort: { field: manual, order: asc }\nmanualOrder: [notes/one/sub/b.md, notes/one/sub/a.md]\n`;
    const file = parseCompilation(raw, 'notes/one');
    const row = compilationRow(file, owner);
    expect(row).toMatchObject({ kind: 'dynamic', sort: { field: 'manual' }, manualOrder: ['notes/one/sub/b.md', 'notes/one/sub/a.md'] });
    expect(compilationFile(row)).toEqual(file);
    expect(parseCompilation(serializeCompilation(file), 'notes/one')).toEqual(file);
    // Another sort keeps the order, so choosing manual again restores it.
    if (row.kind !== 'dynamic') throw new Error('expected a dynamic row');
    expect(compilationFile({ ...row, sort: { field: 'title', order: 'asc' } })).toMatchObject({ sort: { field: 'title' }, manualOrder: ['notes/one/sub/b.md', 'notes/one/sub/a.md'] });
  });
  it('rejects a manual order on pinned items, a repeated path, or a path outside the notebook', () => {
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems: []\nmanualOrder: [notes/one/a.md]\n')).toThrow(/manualOrder/);
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: tag, tag: t }\nmanualOrder: [notes/one/a.md, notes/one/a.md]\n')).toThrow(/repeats/);
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: tag, tag: t }\nmanualOrder: [notes/two/a.md]\n', 'notes/one')).toThrow(/outside/);
  });
  it('names the problem of an invalid file instead of dropping it', () => {
    expect(() => parseCompilation('version: 1\nid: bad id\ntitle: X\narrangement: lane\nitems: []\n')).toThrow('id:');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: carousel\nitems: []\n')).toThrow('arrangement');
    expect(() => parseCompilation('version: 2\nid: x\n')).toThrow('version');
    expect(() => parseCompilation('a: [unclosed')).toThrow('Invalid YAML');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: ../secret.md }\n')).toThrow('items.0.path');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: notes/one/a.md, extra: 1 }\n')).toThrow();
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: notes/one/a.md }\n  - { id: a, kind: note, path: notes/one/b.md }\n')).toThrow('Duplicate item id');
    expect(() => parseCompilation(`version: 1\nid: x\ntitle: X\narrangement: lane\nitems: [${Array.from({ length: 101 }, (_, n) => `{ id: i${n}, kind: note, path: notes/one/a.md }`).join(', ')}]\n`)).toThrow();
  });
  it('keeps items and the source inside the notebook, except YouTube', () => {
    expect(() => parseCompilation(custom, 'notes/two')).toThrow('outside the notebook notes/two');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/other }\n', 'notes/one')).toThrow('outside the notebook');
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: v, kind: youtube, videoId: dQw4w9WgXcQ }\n', 'notes/one')).not.toThrow();
    expect(() => parseCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: notes/one2/a.md }\n', 'notes/one')).toThrow('outside the notebook');
  });
  it('recognises the file name pattern anywhere under a notebook', () => {
    expect(isCompilationPath('notes/one/deep/er/x.compilation.yml')).toBe(true);
    expect(isCompilationPath('notes/one/x.yml')).toBe(false);
    expect(isCompilationPath('notes/one/x.compilation.yaml')).toBe(false);
  });
});

describe('compilation listing fields', () => {
  it('lists title, tags, status and a bounded summary', () => {
    const fields = compilationFields(custom, owner.path, 'notes/one');
    expect(fields).toMatchObject({ title: 'Reading queue', tags: ['reading'], status: 'working', metadata: { id: 'reading-queue', arrangement: 'lane', size: 'medium', itemCount: 3 } });
    expect(fields.invalid).toBeUndefined();
    expect(compilationFields(dynamic, owner.path).metadata).toMatchObject({ arrangement: 'book', sourceKind: 'tag' });
    expect(compilationFields(book, owner.path).metadata).toMatchObject({ arrangement: 'book', sourceKind: 'tag' });
    expect(JSON.stringify(compilationFields(`${custom}graph: { nodes: [] }\n`, owner.path).metadata)).not.toContain('nodes');
  });
  it('still lists an invalid file, with what can be read and the reason', () => {
    const fields = compilationFields('title: Half done\ntags: [a]\nstatus: todo\narrangement: nope\n', 'notes/one/half.compilation.yml');
    expect(fields).toMatchObject({ title: 'Half done', tags: ['a'], status: 'todo' });
    expect(fields.invalid).toContain('arrangement');
    expect(compilationFields('{{{', 'notes/one/broken.compilation.yml')).toMatchObject({ title: 'broken', tags: [] });
    expect(compilationFields('{{{', 'notes/one/broken.compilation.yml').invalid).toContain('Invalid YAML');
  });
  it('reports scope problems as invalid', () => {
    expect(compilationFields(custom, owner.path, 'notes/two').invalid).toContain('outside the notebook');
  });
});

describe('tag and status edits', () => {
  it('carry the caller metadata into the file and keep its comments', () => {
    const commented = `# my reading list\n${custom}`;
    const next = applyCompilationMetadata(commented, { tags: ['reading', 'new'], status: 'done' });
    expect(next).toContain('# my reading list');
    expect(YAML.parse(next)).toMatchObject({ tags: ['reading', 'new'], status: 'done' });
    expect(parseCompilation(next, 'notes/one').items).toHaveLength(3);
  });
  it('removes tags and status when the caller has none, and leaves an unchanged file byte for byte', () => {
    const next = applyCompilationMetadata(custom, { tags: [], status: undefined });
    expect(YAML.parse(next)).not.toHaveProperty('tags');
    expect(YAML.parse(next)).not.toHaveProperty('status');
    expect(applyCompilationMetadata(custom, { tags: ['reading'], status: 'working' })).toBe(custom);
    expect(applyCompilationMetadata('not: [valid', { tags: ['x'] })).toBe('not: [valid');
  });
});

describe('reference rewrite', () => {
  const move = (path: string) => path.startsWith('notes/one/sub') ? 'notes/one/renamed' + path.slice('notes/one/sub'.length) : path === 'notes/one/a.md' ? 'notes/one/b.md' : path;
  it('rewrites pinned items, folder items, folder sources, the manual order and graph nodes', () => {
    const raw = `${custom}graph:\n  nodes:\n    - { path: notes/one/a.md, x: 0, y: 0 }\n`;
    const next = relocateCompilation(raw, move)!;
    const value = YAML.parse(next);
    expect(value.items.map((item: { path?: string; }) => item.path)).toEqual(['notes/one/b.md', undefined, 'notes/one/renamed']);
    expect(value.graph.nodes[0].path).toBe('notes/one/b.md');
    expect(YAML.parse(relocateCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: folder, path: notes/one/sub }\n', move)!).source.path).toBe('notes/one/renamed');
    const ordered = YAML.parse(relocateCompilation('version: 1\nid: x\ntitle: X\narrangement: lane\nsource: { kind: tag, tag: t }\nmanualOrder: [notes/one/a.md, notes/one/c.md]\n', move)!);
    expect(ordered.manualOrder).toEqual(['notes/one/b.md', 'notes/one/c.md']);
  });
  it('returns null when nothing it names moved, and for an unreadable file', () => {
    expect(relocateCompilation(dynamic, move)).toBeNull();
    expect(relocateCompilation('{{{', move)).toBeNull();
    expect(relocateCompilation(custom, path => path)).toBeNull();
  });
});

describe('copy', () => {
  const file = parseCompilation(custom, 'notes/one');
  it('titles the copy, gives it a new identity and fresh item ids', () => {
    let n = 0;
    const copy = copyCompilation(file, [file.id], () => `new-${++n}`);
    expect(copy).toMatchObject({ id: 'reading-queue-copy', title: 'Reading queue copy' });
    expect(copy.items!.map(item => item.id)).toEqual(['new-1', 'new-2', 'new-3']);
    expect(copy.items!.map(item => item.kind)).toEqual(file.items!.map(item => item.kind));
    expect(file.items![0].id).toBe('a1');
    expect(parseCompilation(serializeCompilation(copy), 'notes/one')).toEqual(copy);
  });
  it('picks an unused id, bounds the title and copies a dynamic compilation without items', () => {
    expect(copyCompilation(file, [file.id, 'reading-queue-copy']).id).toBe('reading-queue-copy-2');
    expect(copyCompilation({ ...file, title: 'x'.repeat(100) }, []).title).toHaveLength(100);
    const dynamicFile = parseCompilation(dynamic);
    expect(copyCompilation(dynamicFile, []).items).toBeUndefined();
    expect(copyCompilation({ ...file, id: 'a'.repeat(64) }, []).id.length).toBeLessThanOrEqual(64);
  });
  it('writes the copy beside the original as <name>-copy.compilation.yml', () => {
    expect(compilationCopyPath('notes/one/sub/reading.compilation.yml', () => false)).toBe('notes/one/sub/reading-copy.compilation.yml');
    expect(compilationCopyPath('notes/one/reading.compilation.yml', path => path.endsWith('reading-copy.compilation.yml'))).toBe('notes/one/reading-copy-2.compilation.yml');
  });
});

describe('file names', () => {
  it('derives a stem from a title in any script', () => {
    expect(compilationSlug('Reading Queue!')).toBe('reading-queue');
    expect(compilationSlug('閱讀 清單')).toBe('閱讀-清單');
    expect(compilationSlug('///')).toBe('compilation');
    expect(compilationSlug('a'.repeat(100)).length).toBe(60);
  });
  it('suffixes collisions', () => {
    const taken = new Set(['notes/one/a.compilation.yml', 'notes/one/a-2.compilation.yml']);
    expect(uniqueCompilationPath('notes/one', 'a', path => taken.has(path))).toBe('notes/one/a-3.compilation.yml');
    expect(uniqueCompilationPath('', 'b', () => false)).toBe('b.compilation.yml');
  });
});

describe('membership and item moves', () => {
  const rows = (): ReturnType<typeof compilationRow>[] => ['one', 'two'].map((id, index) => compilationRow({ version: 1, id, title: id, arrangement: 'lane', items: [{ id: `n${index}`, kind: 'note', path: 'notes/one/a.md' }] } satisfies CompilationFile, { notebookId: 'one', path: `notes/one/${id}.compilation.yml` }));
  it('moves an item between custom compilations of one notebook', () => {
    const page = { rows: rows() };
    const moved = moveCompilationItem(page, 'n0', 'two', 1);
    expect(moved.rows[0]).toMatchObject({ items: [] });
    expect(moved.rows[1]).toMatchObject({ items: [{ id: 'n1' }, { id: 'n0' }] });
    expect(page.rows[0]).toMatchObject({ items: [{ id: 'n0' }] });
    expect(() => moveCompilationItem({ rows: [...rows(), compilationRow(parseCompilation(dynamic), { notebookId: 'one', path: 'notes/one/d.compilation.yml' })] }, 'n0', 'clues', 0)).toThrow('Only custom');
    expect(() => moveCompilationItem({ rows: [rows()[0], { ...rows()[1], notebookId: 'other' }] }, 'n0', 'two', 0)).toThrow('Items stay inside their notebook');
  });
  it('judges membership by pinned notes, tag or folder, hiding archived notes from dynamic ones', () => {
    const note = (path: string, extra: object = {}) => ({ notebookId: 'one', path, tags: [] as string[], metadata: {}, ...extra });
    const notes = [note('notes/one/a.md'), note('notes/one/sub/b.md', { tags: ['clue'] }), note('notes/one/sub/deep/c.md'), note('notes/one/d.md', { tags: ['clue'], status: 'archived' })];
    expect(compilationNotes(rows()[0], notes).map(item => item.path)).toEqual(['notes/one/a.md']);
    expect(compilationNotes(compilationRow(parseCompilation(dynamic), owner), notes).map(item => item.path)).toEqual(['notes/one/sub/b.md']);
    const folder = compilationRow(parseCompilation('version: 1\nid: f\ntitle: F\narrangement: lane\nsource: { kind: folder, path: notes/one/sub, recursive: false }\n'), owner);
    expect(compilationNotes(folder, notes).map(item => item.path)).toEqual(['notes/one/sub/b.md']);
  });
});

describe('YouTube URLs', () => {
  it('accepts only recognized YouTube URLs and extracts playback start time', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual({ videoId: 'dQw4w9WgXcQ', start: 90 });
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', start: 0 });
    for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=bad', 'https://u:p@youtube.com/watch?v=dQw4w9WgXcQ']) expect(parseYouTubeUrl(url)).toBeNull();
  });
});

describe('replaceFileTags', () => {
  it('replaces the tags of a compilation and keeps status, items and comments', () => {
    const raw = `# my list\n${custom}`;
    const next = replaceFileTags(raw, 'notes/one/reading.compilation.yml', ['queue', 'later']);
    expect(YAML.parse(next)).toMatchObject({ id: 'reading-queue', status: 'working', tags: ['queue', 'later'], items: expect.any(Array) });
    expect(next.startsWith('# my list')).toBe(true);
  });
  it('removes the key when the tags become empty', () => {
    expect(YAML.parse(replaceFileTags(custom, 'notes/one/reading.compilation.yml', [])).tags).toBeUndefined();
  });
  it('touches nothing but the tags, a status or field that does not validate included', () => {
    const odd = 'version: 1\nid: odd\ntitle: Odd\nstatus: 3\nunknown: {a: 1}\nsource:\n  kind: tag\n  tag: x\ntags: [old]\n';
    const next = replaceFileTags(odd, 'notes/one/odd.compilation.yml', ['new']);
    expect(YAML.parse(next)).toMatchObject({ status: 3, unknown: { a: 1 }, tags: ['new'] });
  });
  it('returns the text itself when the tags already match or it is not a mapping', () => {
    expect(replaceFileTags(custom, 'notes/one/reading.compilation.yml', ['reading'])).toBe(custom);
    expect(replaceFileTags('- just\n- a list\n', 'notes/one/x.compilation.yml', ['a'])).toBe('- just\n- a list\n');
  });
  it('patches the frontmatter of a note', () => {
    expect(replaceFileTags('---\ntags: [a]\n---\nBody\n', 'notes/one/a.md', ['b'])).toBe('---\ntags: [b]\n---\nBody\n');
  });
});
