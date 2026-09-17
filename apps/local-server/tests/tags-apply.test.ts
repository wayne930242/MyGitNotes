import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { createApp } from '../src/app.js';
import { GitHubSource, GitLabSource, assetHash, type RemoteChange } from '@mygitnotes/core';

vi.mock('../src/auth.js', async original => ({ ...await original<typeof import('../src/auth.js')>(), authToken: async () => 'fixture-token' }));

describe('local /api/tags/apply', () => {
  let root: string;
  let server: Server;
  let base: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const post = (body: unknown) => fetch(`${base}/api/tags/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-tags-apply-'));
    vi.stubEnv('GITHUB_NOTES_SOURCE', 'local');
    vi.stubEnv('GITHUB_NOTES_LOCAL_PATH', root);
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    fs.mkdirSync(path.join(root, 'notes/blog'), { recursive: true });
    fs.mkdirSync(path.join(root, 'notes/thesis'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'notes/.mygitnotes.yaml'),
      'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: blog\nnotebooks:\n  - id: blog\n    title: Blog\n    root: notes/blog\n  - id: thesis\n    title: Thesis\n    root: notes/thesis\n'
    );
    fs.writeFileSync(
      path.join(root, 'notes/blog/a.md'),
      '---\nid: a\ncustom: {x: 1,y: 2}\ntags: [todo, x]\ntitle: A\n---\n\nBody A\n'
    );
    fs.writeFileSync(
      path.join(root, 'notes/blog/b.md'),
      '---\nid: b\ntags: [todo, doing]\n---\n\nBody B\n'
    );
    fs.writeFileSync(
      path.join(root, 'notes/thesis/c.md'),
      '---\nid: c\ntags:\n  - todo\ntitle: C\n---\n\nBody C\n'
    );
    fs.writeFileSync(path.join(root, 'notes/blog/d.md'), '---\nid: d\ntags: [other]\n---\n\nBody D\n');
    git('add', '.');
    git('commit', '-m', 'fixture');
    server = createServer(createApp(root));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renames a tag across notebooks in one commit, preserving every other byte', async () => {
    const before = fs.readFileSync(path.join(root, 'notes/blog/a.md'), 'utf8');
    const commitsBefore = git('rev-list', '--count', 'HEAD').toString().trim();
    const res = await post({
      entries: [
        { path: 'notes/blog/a.md', notebookId: 'blog', tags: ['doing', 'x'] },
        { path: 'notes/blog/b.md', notebookId: 'blog', tags: ['doing'] }, // dedupe: already had "doing"
        { path: 'notes/thesis/c.md', notebookId: 'thesis', tags: ['doing'] },
      ],
      message: 'rename todo to doing',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, changedPaths: ['notes/blog/a.md', 'notes/blog/b.md', 'notes/thesis/c.md'] });
    expect(body.commit.commitHash).toBeTruthy();
    const commitsAfter = git('rev-list', '--count', 'HEAD').toString().trim();
    expect(Number(commitsAfter)).toBe(Number(commitsBefore) + 1);
    expect(git('show', '--stat', 'HEAD').toString()).toContain('3 files changed');

    const after = fs.readFileSync(path.join(root, 'notes/blog/a.md'), 'utf8');
    expect(after).toBe(before.replace('tags: [todo, x]', 'tags: [doing, x]'));
    expect(after).toContain('custom: {x: 1,y: 2}'); // untouched other frontmatter, byte-exact
    expect(after).toContain('Body A\n'); // untouched body

    expect(fs.readFileSync(path.join(root, 'notes/blog/b.md'), 'utf8')).toContain('tags: [doing]'); // deduped, single tag
    expect(fs.readFileSync(path.join(root, 'notes/thesis/c.md'), 'utf8')).toContain('  - doing'); // block style preserved

    // A note that never had the tag is untouched.
    expect(fs.readFileSync(path.join(root, 'notes/blog/d.md'), 'utf8')).toContain('tags: [other]');
  });

  it('undoes an operation as one more commit, restoring exact prior tags without disturbing later edits', async () => {
    await post({ entries: [{ path: 'notes/blog/a.md', notebookId: 'blog', tags: ['doing', 'x'] }], message: 'rename' });
    // Simulate an unrelated edit to the note's body/title after the rename, before undo.
    const midway = fs.readFileSync(path.join(root, 'notes/blog/a.md'), 'utf8').replace('Body A', 'Body A, edited').replace('title: A', 'title: A2');
    fs.writeFileSync(path.join(root, 'notes/blog/a.md'), midway);
    git('commit', '-am', 'unrelated edit');

    const commitsBefore = git('rev-list', '--count', 'HEAD').toString().trim();
    const undo = await post({ entries: [{ path: 'notes/blog/a.md', notebookId: 'blog', tags: ['todo', 'x'] }], message: 'undo rename' });
    expect(undo.status).toBe(200);
    const commitsAfter = git('rev-list', '--count', 'HEAD').toString().trim();
    expect(Number(commitsAfter)).toBe(Number(commitsBefore) + 1);

    const restored = fs.readFileSync(path.join(root, 'notes/blog/a.md'), 'utf8');
    expect(restored).toContain('tags: [todo, x]'); // undo restored the exact original tag array
    expect(restored).toContain('title: A2'); // the unrelated edit made after the operation survives undo
    expect(restored).toContain('Body A, edited\n');
  });

  it('deletes a tag, leaving an empty array rather than removing the key', async () => {
    fs.writeFileSync(path.join(root, 'notes/blog/e.md'), '---\nid: e\ntags: [solo]\n---\n\nBody E\n');
    git('add', '.'); git('commit', '-m', 'add e');
    const res = await post({ entries: [{ path: 'notes/blog/e.md', notebookId: 'blog', tags: [] }], message: 'delete solo' });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'notes/blog/e.md'), 'utf8')).toContain('tags: []');
  });

  it('makes no commit and reports no changed paths when every entry is already at its target', async () => {
    const commitsBefore = git('rev-list', '--count', 'HEAD').toString().trim();
    const res = await post({ entries: [{ path: 'notes/blog/d.md', notebookId: 'blog', tags: ['other'] }], message: 'no-op' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, changedPaths: [] });
    expect(git('rev-list', '--count', 'HEAD').toString().trim()).toBe(commitsBefore);
  });

  it('rejects a path outside the configured notebooks and an empty entries array', async () => {
    expect((await post({ entries: [] })).status).toBe(400);
    expect((await post({ entries: [{ path: '../outside.md', notebookId: 'blog', tags: [] }] })).status).toBe(403);
    expect((await post({ entries: [{ path: '.env', notebookId: 'blog', tags: [] }] })).status).toBe(403);
    expect((await post({ entries: [{ path: 'notes/blog/missing.md', notebookId: 'blog', tags: [] }] })).status).toBe(403);
  });

  it('leaves every note untouched on disk when a later entry in the same batch fails validation', async () => {
    const before = fs.readFileSync(path.join(root, 'notes/blog/a.md'), 'utf8');
    const commitsBefore = git('rev-list', '--count', 'HEAD').toString().trim();
    const res = await post({
      entries: [
        { path: 'notes/blog/a.md', notebookId: 'blog', tags: ['doing', 'x'] },
        { path: 'notes/blog/missing.md', notebookId: 'blog', tags: [] },
      ],
    });
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(root, 'notes/blog/a.md'), 'utf8')).toBe(before);
    expect(git('rev-list', '--count', 'HEAD').toString().trim()).toBe(commitsBefore);
    expect(git('status', '--porcelain').toString().trim()).toBe('');
  });
});

describe.each(['github', 'gitlab'])('remote /api/tags/apply (%s)', provider => {
  it('applies one atomic commit across notebooks and preserves other frontmatter bytes', async () => {
    const files = new Map([
      ['.mygitnotes.yaml', Buffer.from('schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: blog\nnotebooks:\n  - id: blog\n    title: Blog\n    root: notes/blog\n  - id: thesis\n    title: Thesis\n    root: notes/thesis\n')],
      ['notes/blog/a.md', Buffer.from('---\nid: a\ncustom: {x: 1,y: 2}\ntags: [todo, x]\ntitle: A\n---\n\nBody A\n')],
      ['notes/thesis/c.md', Buffer.from('---\nid: c\ntags:\n  - todo\n---\n\nBody C\n')],
    ]);
    let revision = 'one';
    let canPush = true;
    const published: RemoteChange[][] = [];
    const prototype = (provider === 'github' ? GitHubSource : GitLabSource).prototype as any;
    vi.spyOn(prototype, 'loadSnapshot').mockImplementation(async () => {
      const dirs = new Set<string>();
      for (const file of files.keys()) { const parts = file.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
      return { sha: revision, treeSha: revision, info: { private: true, permissions: { push: canPush }, default_branch: 'main' }, entries: [
        ...[...dirs].map(p => ({ path: p, type: 'tree', mode: '040000', sha: p })),
        ...[...files].map(([p, bytes]) => ({ path: p, type: 'blob', mode: '100644', sha: assetHash(bytes), size: bytes.length })),
      ] };
    });
    vi.spyOn(prototype, 'readBlob').mockImplementation(async (...args: unknown[]) => [...files.values()].find(bytes => assetHash(bytes) === args[0])!);
    vi.spyOn(prototype, 'publishChanges').mockImplementation(async (...args: unknown[]) => {
      const changes = args[0] as RemoteChange[];
      published.push(changes);
      for (const change of changes) {
        if (change.sha === null) files.delete(change.path);
        else files.set(change.path, change.content !== undefined ? Buffer.from(change.content) : Buffer.alloc(0));
      }
      return (revision += '-next');
    });
    vi.stubEnv('MYGITNOTES_SOURCE', provider);
    vi.stubEnv('MYGITNOTES_REPOSITORY', 'example/notes');
    vi.stubEnv('MYGITNOTES_BRANCH', 'main');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VERCEL', '');
    const server = createServer(createApp(process.cwd()));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = (body: unknown) => fetch(`${base}/api/tags/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const res = await post({
        entries: [
          { path: 'notes/blog/a.md', notebookId: 'blog', tags: ['doing', 'x'] },
          { path: 'notes/thesis/c.md', notebookId: 'thesis', tags: ['doing'] },
        ],
        revision,
        message: 'rename todo to doing',
      });
      expect(res.status).toBe(200);
      expect(published).toHaveLength(1); // one atomic commit for both notebooks
      expect(published[0]).toHaveLength(2);
      const updatedA = files.get('notes/blog/a.md')!.toString();
      expect(updatedA).toBe('---\nid: a\ncustom: {x: 1,y: 2}\ntags: [doing, x]\ntitle: A\n---\n\nBody A\n');
      expect(files.get('notes/thesis/c.md')!.toString()).toContain('  - doing');

      canPush = false;
      const readsBefore = (prototype.readBlob as any).mock.calls.length;
      const forbidden = await post({ entries: [{ path: 'notes/blog/a.md', notebookId: 'blog', tags: ['x'] }], revision, message: 'x' });
      expect(forbidden.status).toBe(403);
      // A caller without push permission must not have its entries' blobs read at all.
      expect((prototype.readBlob as any).mock.calls.length).toBe(readsBefore);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });
});
