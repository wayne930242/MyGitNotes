import { describe, expect, it, vi } from 'vitest';
import { type FolderSnapshot, planFolderChange, relocateLinks } from '../src/folder-plan.js';
import { planFileChange } from '../src/file-manager.js';
import { callNoteShell } from '../src/note-shell.js';
import { openRemoteHome } from '../src/remote-factory.js';
import { githubFixture } from './fixtures/github.js';
import { gitlabFixture } from './fixtures/gitlab.js';

vi.setConfig({ testTimeout: 30000 });

const outline = '- Plan **today**\r\n  Annotation\r\n  - [A\\] 中文](a.md#part) and [external](https://example.test/a.md?q=1#part)\r\n  - [Reference][a]\r\n\r\n[a]: <a.md#part> "Title"\r\n';
const movedOutline = outline.replaceAll('(a.md#part)', '(../a.md#part)').replace('<a.md#part>', '<../a.md#part>');

describe('source-preserving outline relocation', () => {
  it('rebases escaped labels, references and CRLF without changing hierarchy or external links', () => {
    expect(relocateLinks(outline, 'notes/ex/plan.outline.md', 'notes/ex/work/plan.outline.md', file => file)).toBe(movedOutline);
  });
  it.each(['`[literal](a.md)`', '``[literal](a.md) ` still code``', '```md\n[literal](a.md)\n```\n', '~~~md\r\n[literal](a.md)\r\n~~~~\r\n', '```md\n[literal](a.md)\n', '  ~~~md\n  [literal](a.md)\n', '    [literal](a.md)\n', '- Parent\n\n      [literal](a.md)\n', '> ```\n> [literal](a.md)\n> ```\n', '- Parent\n  ```\n  [literal](a.md)\n  ```\n', '- [incomplete](a.md', '- [incomplete label a.md'])('keeps code/incomplete Markdown bytes: %j', literal => {
    expect(relocateLinks(literal, 'notes/ex/plan.outline.md', 'notes/ex/work/plan.outline.md', file => file)).toBe(literal);
  });
  it('distinguishes nested indented code from sibling links with identical text', () => {
    const raw = '- Parent\r\n\r\n      [same](a.md)\r\n\r\n  - [same](a.md)\r\n';
    expect(relocateLinks(raw, 'notes/ex/plan.outline.md', 'notes/ex/work/plan.outline.md', file => file)).toBe(raw.replace('- [same](a.md)', '- [same](../a.md)'));
  });
  it('does not let a longer closing fence swallow a following link and inline code', () => {
    const raw = '```\n[literal](a.md)\n````\n- [real](a.md)\n`code`\n';
    expect(relocateLinks(raw, 'notes/ex/plan.outline.md', 'notes/ex/work/plan.outline.md', file => file)).toBe(raw.replace('[real](a.md)', '[real](../a.md)'));
  });
  it('still rewrites links after a closed fence and before an unfinished fence', () => {
    const raw = '```\n[x](a.md)\n````\n- [real](a.md)\n~~~\n[x](a.md)\n';
    expect(relocateLinks(raw, 'notes/ex/plan.outline.md', 'notes/ex/work/plan.outline.md', file => file)).toBe(raw.replace('[real](a.md)', '[real](../a.md)'));
  });
  const snapshot = (): FolderSnapshot => ({ notebooks: [{ id: 'ex', title: 'Example', root: 'notes/ex' }], directories: ['notes/ex', 'notes/ex/work', 'notes/ex/old'], protectedPaths: [], files: new Map([['notes/ex/old/plan.outline.md', '- Parent\n  Annotation\n  - [A](../a.md#part)\n'], ['notes/ex/a.md', '[Plan](old/plan.outline.md)\n']]) });
  it('file moves update incoming/outgoing outline links together; deletion retains referring bytes', () => {
    const source = snapshot();
    const before = { ...source, files: new Map([...source.files].map(([file, raw]) => [file, Buffer.from(raw)])) };
    const after = planFileChange(before, { kind: 'move', notebookId: 'ex', path: 'notes/ex/old/plan.outline.md', destination: 'notes/ex/plan.outline.md' });
    expect(after.files.get('notes/ex/plan.outline.md')?.toString()).toBe('- Parent\n  Annotation\n  - [A](a.md#part)\n');
    expect(after.files.get('notes/ex/a.md')?.toString()).toBe('[Plan](plan.outline.md)\n');
    const targetMove = planFileChange(after, { kind: 'move', notebookId: 'ex', path: 'notes/ex/a.md', destination: 'notes/ex/work/a.md' });
    expect(targetMove.files.get('notes/ex/plan.outline.md')?.toString()).toContain('[A](work/a.md#part)');
    const deleted = planFileChange(targetMove, { kind: 'delete', notebookId: 'ex', path: 'notes/ex/work/a.md' });
    expect(deleted.files.get('notes/ex/plan.outline.md')).toEqual(targetMove.files.get('notes/ex/plan.outline.md'));
  });
  it.each(['move', 'delete'])('folder %s retains contents and rebases outlines and incoming links', kind => {
    const after = planFolderChange(snapshot(), kind === 'move' ? { kind, notebookId: 'ex', path: 'old', parent: 'work' } : { kind, notebookId: 'ex', path: 'old', destination: 'work' });
    const prefix = kind === 'move' ? 'work/old' : 'work';
    expect(after.files.get(`notes/ex/${prefix}/plan.outline.md`)).toBe(`- Parent\n  Annotation\n  - [A](${kind === 'move' ? '../../' : '../'}a.md#part)\n`);
    expect(after.files.get('notes/ex/a.md')).toBe(`[Plan](${prefix}/plan.outline.md)\n`);
  });
});

const manifest = 'schema_version: 1\nworkspace:\n  title: Relocation\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n  - id: other\n    title: Other\n    root: notes/other\n';
function providerFixture(provider: 'github' | 'gitlab', extra: Record<string, string> = {}) {
  const files = { '.github-notes.yaml': manifest, 'notes/ex/plan.outline.md': outline, 'notes/ex/ref.md': '[Plan](plan.outline.md#top)\n', 'notes/ex/work/_dir.yml': 'title: Work\n', 'notes/other/_dir.yml': 'title: Other\n', ...extra };
  if (provider === 'github') {
    const f = githubFixture(files);
    return { reader: f.reader, text: f.text, head: f.head, commits: () => f.calls.filter(c => c.endpoint === '/git/commits'), paths: () => f.calls.filter(c => c.endpoint === '/git/trees' && c.method).flatMap(c => c.body.tree.map((e: { path: string; }) => e.path)) };
  }
  const f = gitlabFixture(undefined, files);
  f.files.delete('notes/.github-notes.yaml');
  return { reader: () => openRemoteHome({ type: 'gitlab', repository: 'group/subgroup/project', branch: 'main', url: 'https://gitlab.example.test/gitlab' }, 'test-token', f.request).reader, text: (name: string) => f.files.get(name), head: () => f.head, commits: () => f.calls.filter(c => c.url.endsWith('/repository/commits') && c.init?.method === 'POST'), paths: () => f.calls.filter(c => c.url.endsWith('/repository/commits') && c.init?.method === 'POST').flatMap(c => (JSON.parse(String(c.init?.body)) as { actions: { file_path: string; }[]; }).actions.map(a => a.file_path)) };
}

describe.each(['github', 'gitlab'] as const)('%s snapshot-pinned shell relocation', provider => {
  it('moves an outline into a directory with incoming and outgoing edits in one commit', async () => {
    const f = providerFixture(provider);
    const reader = f.reader();
    const snapshotRead = vi.spyOn(reader, 'readSnapshotFile');
    const mutableRead = vi.spyOn(reader, 'readFile');
    await callNoteShell(reader, 'mv', { source: 'notes/ex/plan.outline.md', destination: 'notes/ex/work/', revision: f.head() }, true);
    expect(f.text('notes/ex/work/plan.outline.md')).toBe(movedOutline);
    expect(f.text('notes/ex/ref.md')).toBe('[Plan](work/plan.outline.md#top)\n');
    expect(f.text('notes/ex/plan.outline.md')).toBeUndefined();
    expect(f.commits()).toHaveLength(1);
    expect(f.paths().sort()).toEqual(['notes/ex/plan.outline.md', 'notes/ex/ref.md', 'notes/ex/work/plan.outline.md']);
    expect(snapshotRead.mock.calls.length).toBeGreaterThan(0);
    expect(new Set(snapshotRead.mock.calls.map(([snapshot]) => snapshot.sha)).size).toBe(1);
    expect(mutableRead.mock.calls.filter(([file]) => file.endsWith('.md'))).toEqual([]);
  });
  it('moves a target across same-repository notebooks without guessing another repository', async () => {
    const f = providerFixture(provider);
    await callNoteShell(f.reader(), 'mv', { source: 'notes/ex/a.md', destination: 'notes/other/a.md', revision: f.head() }, true);
    expect(f.text('notes/ex/plan.outline.md')).toBe(outline.replaceAll('(a.md#part)', '(../other/a.md#part)').replace('<a.md#part>', '<../other/a.md#part>'));
    expect(f.commits()).toHaveLength(1);
  });
  it('moves a folder and keeps overwrite source precedence over the overwritten old body', async () => {
    const f = providerFixture(provider, { 'notes/ex/old/plan.outline.md': '- [A](../a.md)\n', 'notes/ex/work/plan.outline.md': '- OLD [A](../a.md)\n', 'notes/ex/ref.md': '[Plan](old/plan.outline.md)\n' });
    await callNoteShell(f.reader(), 'mv', { source: 'notes/ex/old', destination: 'notes/ex/new', recursive: true, revision: f.head() }, true);
    expect(f.text('notes/ex/ref.md')).toBe('[Plan](new/plan.outline.md)\n');
    await callNoteShell(f.reader(), 'mv', { source: 'notes/ex/plan.outline.md', destination: 'notes/ex/work/plan.outline.md', overwrite: true, revision: f.head() }, true);
    expect(f.text('notes/ex/work/plan.outline.md')).toBe(movedOutline);
    expect(f.commits()).toHaveLength(2);
  });
  it('refuses a branch race while reading the pinned incoming references', async () => {
    const f = providerFixture(provider);
    const reader = f.reader();
    const read = reader.readSnapshotFile.bind(reader);
    let advanced = false;
    let concurrentHead = '';
    vi.spyOn(reader, 'readSnapshotFile').mockImplementation(async (snapshot, file) => {
      if (!advanced) {
        advanced = true;
        await f.reader().commitChanges([{ path: 'notes/ex/ref.md', content: 'Concurrent source edit\n' }], f.head(), 'write');
        concurrentHead = f.head();
      }
      return read(snapshot, file);
    });
    await expect(callNoteShell(reader, 'mv', { source: 'notes/ex/a.md', destination: 'notes/ex/work/a.md', revision: f.head() }, true)).rejects.toMatchObject({ status: 409 });
    expect(f.text('notes/ex/ref.md')).toBe('Concurrent source edit\n');
    expect(f.text('notes/ex/plan.outline.md')).toBe(outline);
    expect(f.text('notes/ex/a.md')).toBeDefined();
    expect(f.text('notes/ex/work/a.md')).toBeUndefined();
    expect(f.head()).toBe(concurrentHead);
    // GitHub may create an unreachable commit, but its non-fast-forward ref update fails.
    expect(f.commits()).toHaveLength(provider === 'github' ? 2 : 1);
  });
  it('keeps the existing 200-file commit bound after adding incoming references', async () => {
    const refs = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`notes/ex/ref-${index}.outline.md`, '- [A](a.md)\n']));
    const f = providerFixture(provider, refs);
    await expect(callNoteShell(f.reader(), 'mv', { source: 'notes/ex/a.md', destination: 'notes/ex/work/a.md', revision: f.head() }, true)).rejects.toThrow(/200/);
    expect(f.commits()).toHaveLength(0);
    expect(f.text('notes/ex/a.md')).toBeDefined();
  });
  it('leaves copy and delete reference semantics unchanged, and rejects stale moves without a commit', async () => {
    const f = providerFixture(provider);
    const base = f.head();
    await callNoteShell(f.reader(), 'cp', { source: 'notes/ex/plan.outline.md', destination: 'notes/ex/work/copied.outline.md', revision: base }, true);
    expect(f.text('notes/ex/work/copied.outline.md')).toBe(outline);
    await expect(callNoteShell(f.reader(), 'mv', { source: 'notes/ex/a.md', destination: 'notes/ex/work/a.md', revision: base }, true)).rejects.toMatchObject({ status: 409 });
    expect(f.commits()).toHaveLength(1);
    await callNoteShell(f.reader(), 'rm', { paths: ['notes/ex/a.md'], revision: f.head() }, true);
    expect(f.text('notes/ex/plan.outline.md')).toBe(outline);
    expect(f.commits()).toHaveLength(2);
  });
});
