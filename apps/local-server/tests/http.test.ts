import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { createApp } from '../src/app.js';
import { credentialToken, seal, SessionStore, unseal } from '../src/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let root: string;
let server: Server;
let base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-http-'));
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'local');
  vi.stubEnv('GITHUB_NOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  fs.mkdirSync(path.join(root, 'notes/example/projects/deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
  fs.writeFileSync(path.join(root, 'notes/example/projects/_dir.yml'), 'title: Projects\n');
  fs.writeFileSync(path.join(root, 'notes/example/projects/deep/note.md'), '# Note');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=hidden');
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('real HTTP local boundaries', () => {
  it('serves product reference documents read-only from the Core checkout, not the workspace', async () => {
    const product = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-product-'));
    fs.mkdirSync(path.join(product, 'docs/agent/product'), { recursive: true });
    fs.writeFileSync(path.join(product, 'docs/agent/product/index.md'), '# Product Guide\n');
    fs.writeFileSync(path.join(product, 'docs/agent/.hidden.md'), '# Hidden\n');
    const split = createServer(createApp(product));
    await new Promise<void>(resolve => split.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(split.address() as any).port}`;
    try {
      const listing = await fetch(`${url}/api/agent-resources`).then(r => r.json());
      expect(listing.docs.filter((r: any) => r.scope === 'product')).toEqual([{ path: 'docs/agent/product/index.md', name: 'Product Guide', editable: false, scope: 'product' }]);
      expect(await fetch(`${url}/api/agent-resources/read?path=docs/agent/product/index.md`).then(r => r.json())).toEqual({ path: 'docs/agent/product/index.md', content: '# Product Guide\n' });
      for (const file of ['docs/agent/.hidden.md', 'docs/agent/../../etc/passwd.md', 'docs/agent/missing.md']) expect((await fetch(`${url}/api/agent-resources/read?path=${encodeURIComponent(file)}`)).ok).toBe(false);
      const save = await fetch(`${url}/api/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'docs/agent/product/index.md', content: 'bad' }) });
      expect(save.ok).toBe(false);
      expect(fs.readFileSync(path.join(product, 'docs/agent/product/index.md'), 'utf8')).toBe('# Product Guide\n');
      expect(fs.existsSync(path.join(root, 'docs'))).toBe(false);
    } finally {
      await new Promise<void>(resolve => split.close(() => resolve()));
      fs.rmSync(product, { recursive: true, force: true });
    }
  });
  it('renders a notebook template and excludes it from note listings', async () => {
    fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n    templates:\n      - id: reading\n        title: Reading\n        file: .templates/reading.md\n');
    fs.mkdirSync(path.join(root, 'notes/example/.templates'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes/example/.templates/reading.md'), '---\ntitle: "{{title}}"\nstatus: unread\n---\n\n# {{title}}\n');
    const rendered = await fetch(`${base}/api/templates/render?notebookId=example&templateId=reading&title=${encodeURIComponent('My Note')}`).then(r => r.json());
    expect(rendered.metadata.title).toBe('My Note');
    expect(rendered.metadata.status).toBe('unread');
    expect(rendered.content).toContain('# My Note');
    const notes = await fetch(`${base}/api/notes?notebookId=example`).then(r => r.json());
    expect(notes.notes.some((n: any) => n.path.includes('.templates'))).toBe(false);
    expect((await fetch(`${base}/api/templates/render?notebookId=example&templateId=missing&title=x`)).status).toBe(400);
  });
  it('commits a reviewed selection without including other staged files', async () => {
    const file = 'notes/example/projects/deep/note.md', other = 'notes/example/other.md';
    fs.writeFileSync(path.join(root, file), '# Selected');
    fs.writeFileSync(path.join(root, other), '# Staged elsewhere');
    git('add', other);
    const changes = (await fetch(`${base}/api/git/changes`).then(r => r.json())).changes;
    const selected = changes.find((entry: any) => entry.path === file);
    const response = await fetch(`${base}/api/git/commit-staged`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected: true, files: [file], revisions: { [file]: selected.revision }, message: 'only selected' }) });
    expect(response.status).toBe(200);
    expect(git('show', `HEAD:${file}`).toString()).toBe('# Selected');
    expect(git('diff', '--cached', '--name-only').toString().trim()).toBe(other);
    expect(git('ls-tree', '--name-only', 'HEAD', other).toString()).toBe('');
  });
  it('manages exact file changes and refuses stale or protected mutations', async () => {
    const file = 'notes/example/projects/deep/note.md';
    const other = 'notes/example/other.md';
    const request = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    fs.writeFileSync(path.join(root, file), '# Changed');
    fs.writeFileSync(path.join(root, other), '# New');
    let changes = (await fetch(`${base}/api/git/changes`).then(r => r.json())).changes;
    const changed = changes.find((entry: any) => entry.path === file);
    expect(changed).toMatchObject({ available: true, staged: false, unstaged: true, tracked: true });
    expect((await fetch(`${base}/api/git/change`, request({ ...changed, action: 'stage' }))).status).toBe(200);
    expect((await fetch(`${base}/api/git/file-diff?path=${file}&side=staged`).then(r => r.json())).diff).toContain('+# Changed');
    fs.writeFileSync(path.join(root, file), '# Later');
    expect((await fetch(`${base}/api/git/change`, request({ ...changed, action: 'restore' }))).status).toBe(409);
    for (const target of ['notes/example', '.env', ':(glob)notes/**', '../outside']) {
      expect((await fetch(`${base}/api/git/change`, request({ path: target, revision: changed.revision, action: 'restore' }))).ok).toBe(false);
    }
    changes = (await fetch(`${base}/api/git/changes`).then(r => r.json())).changes;
    const staged = changes.find((entry: any) => entry.path === file);
    expect((await fetch(`${base}/api/git/commit-staged`, request({ files: [file], revisions: { [file]: staged.revision }, message: 'only staged' }))).status).toBe(200);
    expect(git('show', `HEAD:${file}`).toString()).toBe('# Changed');
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe('# Later');
    const fresh = changes.find((entry: any) => entry.path === other);
    expect((await fetch(`${base}/api/git/change`, request({ ...fresh, action: 'restore' }))).status).toBe(200);
    expect(fs.existsSync(path.join(root, other))).toBe(false);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('SECRET=hidden');
  });
  it('syncs main with its upstream and reports conflicts with their files', async () => {
    const request = (body: unknown = {}) => fetch(`${base}/api/git/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(await request().then(async r => [r.status, (await r.json()).code])).toEqual([409, 'NO_UPSTREAM']);
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-http-remote-'));
    try {
      execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'pipe' });
      git('remote', 'add', 'origin', remote);
      git('push', '-u', 'origin', 'main');
      fs.writeFileSync(path.join(root, 'notes/example/projects/deep/note.md'), '# Local');
      git('commit', '-am', 'local edit');
      expect((await fetch(`${base}/api/git/status`).then(r => r.json())).status).toMatchObject({ upstream: 'origin/main', ahead: 1, behind: 0 });
      const synced = await request();
      expect(synced.status).toBe(200);
      expect((await synced.json()).result).toMatchObject({ upstream: 'origin/main', pulled: 0, pushed: 1 });
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-http-other-'));
      try {
        execFileSync('git', ['clone', remote, other], { stdio: 'pipe' });
        const run = (...args: string[]) => execFileSync('git', args, { cwd: other, stdio: 'pipe' });
        run('config', 'user.name', 'Other');
        run('config', 'user.email', 'other@example.com');
        fs.writeFileSync(path.join(other, 'notes/example/projects/deep/note.md'), '# Remote');
        run('commit', '-am', 'remote edit');
        run('push');
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
      fs.writeFileSync(path.join(root, 'notes/example/projects/deep/note.md'), '# Conflict');
      expect(await request().then(async r => [r.status, (await r.json()).code])).toEqual([409, 'DIRTY']);
      git('commit', '-am', 'conflicting edit');
      const conflict = await request();
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ code: 'CONFLICT', files: ['notes/example/projects/deep/note.md'] });
      expect((await request({ strategy: 'sideways' })).status).toBe(400);
      expect((await request({ strategy: 'local' })).status).toBe(200);
      expect(execFileSync('git', ['show', 'main:notes/example/projects/deep/note.md'], { cwd: remote }).toString()).toBe('# Conflict');
      git('checkout', '-b', 'core');
      expect((await request()).status).toBe(403);
    } finally {
      fs.rmSync(remote, { recursive: true, force: true });
    }
  }, 20000); // Real bare-repo push/clone/sync round trips spawn dozens of git subprocesses; slower under full-suite load.
  it('lists, edits, commits and restores workspace Agent documents while protecting secrets and product paths', async () => {
    const settings = ['AGENTS.md', '.agents/skills/custom/SKILL.md', '.codex/agents/reviewer.toml'];
    for (const file of settings) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), '# Custom settings\n');
    }
    fs.writeFileSync(path.join(root, '.codex/auth.json'), '{"token":"fixture-secret"}');
    git('add', '.');
    git('commit', '-m', 'workspace agent settings');
    const request = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const listing = await fetch(`${base}/api/agent-resources`).then(r => r.json());
    const resources = [...listing.instructions, ...listing.skills, ...listing.docs];
    for (const file of settings) expect(resources).toContainEqual(expect.objectContaining({ path: file, editable: true, scope: 'workspace' }));
    expect(resources.some(r => r.path === '.codex/auth.json')).toBe(false);
    for (const file of settings) {
      expect((await fetch(`${base}/api/agent-resources/save`, request({ path: file, content: '# Changed\n' }))).status).toBe(200);
      expect(await fetch(`${base}/api/agent-resources/read?path=${encodeURIComponent(file)}`).then(r => r.json())).toMatchObject({ content: '# Changed\n' });
      expect((await fetch(`${base}/api/agent-resources/restore`, request({ path: file }))).status).toBe(200);
      expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe('# Custom settings\n');
    }
    for (const file of ['.codex/auth.json', '.codex/config.toml', '.agents/skills/custom/.env', '.agents/skills/custom/run.sh', 'apps/web/AGENTS.md', '.agents/../README.md']) {
      expect((await fetch(`${base}/api/agent-resources/read?path=${encodeURIComponent(file)}`)).ok).toBe(false);
      expect((await fetch(`${base}/api/agent-resources/save`, request({ path: file, content: 'bad' }))).ok).toBe(false);
    }
    fs.symlinkSync(path.join(root, '.env'), path.join(root, '.agents/skills/custom/secret.md'));
    expect((await fetch(`${base}/api/agent-resources/read?path=.agents/skills/custom/secret.md`)).ok).toBe(false);
    expect((await fetch(`${base}/api/agent-resources/save`, request({ path: '.agents/skills/custom/secret.md', content: 'bad' }))).ok).toBe(false);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('SECRET=hidden');
    expect((await fetch(`${base}/api/agent-resources/save`, request({ path: 'AGENTS.md', content: '# Committed\n' }))).ok).toBe(true);
    expect((await fetch(`${base}/api/git/commit`, request({ files: ['AGENTS.md'], message: 'docs(workspace): update rules' }))).ok).toBe(true);
    expect(git('show', 'HEAD:AGENTS.md').toString()).toBe('# Committed\n');
    git('checkout', '-b', 'core');
    expect((await fetch(`${base}/api/agent-resources/save`, request({ path: 'AGENTS.md', content: 'bad' }))).status).toBe(403);
  });
  it('renames a skill directory, preserves its files and updates Agent document references', async () => {
    const skill = path.join(root, '.agents/skills/old-name');
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: old-name\ndescription: Old\n---\nUse $old-name.\n');
    fs.writeFileSync(path.join(skill, 'scripts/run.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Read `.agents/skills/old-name/SKILL.md` and use $old-name.\n');
    expect((await fetch(`${base}/api/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '.agents/skills/old-name/SKILL.md', slug: '../unsafe', content: 'unchanged' }) })).status).toBe(400);
    expect(fs.existsSync(skill)).toBe(true);
    const response = await fetch(`${base}/api/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '.agents/skills/old-name/SKILL.md', slug: 'new-name', content: '---\nname: new-name\ndescription: New\n---\nUse $old-name.\n' }) });
    const result = await response.json();
    expect({ status: response.status, result }).toMatchObject({ status: 200, result: { path: '.agents/skills/new-name/SKILL.md' } });
    expect(fs.existsSync(skill)).toBe(false);
    expect(fs.readFileSync(path.join(root, '.agents/skills/new-name/scripts/run.sh'), 'utf8')).toBe('#!/bin/sh\n');
    expect(fs.readFileSync(path.join(root, '.agents/skills/new-name/SKILL.md'), 'utf8')).toContain('name: new-name');
    expect(fs.readFileSync(path.join(root, '.agents/skills/new-name/SKILL.md'), 'utf8')).toContain('$old-name');
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('Read `.agents/skills/new-name/SKILL.md` and use $old-name.\n');
    const staleSave = await fetch(`${base}/api/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '.agents/skills/old-name/SKILL.md', content: 'stale' }) });
    expect(staleSave.status).toBe(409);
    expect(fs.existsSync(skill)).toBe(false);
  });
  it('rejects a skill rename when the destination directory exists', async () => {
    const oldSkill = path.join(root, '.agents/skills/old-name');
    const newSkill = path.join(root, '.agents/skills/new-name');
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.mkdirSync(newSkill, { recursive: true });
    fs.writeFileSync(path.join(oldSkill, 'SKILL.md'), '---\nname: old-name\n---\nOld\n');
    fs.writeFileSync(path.join(newSkill, 'SKILL.md'), '---\nname: new-name\n---\nExisting\n');
    const response = await fetch(`${base}/api/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '.agents/skills/old-name/SKILL.md', slug: 'new-name', content: '---\nname: new-name\n---\nChanged\n' }) });
    expect(response.status).toBe(409);
    expect(fs.readFileSync(path.join(oldSkill, 'SKILL.md'), 'utf8')).toContain('Old');
    expect(fs.readFileSync(path.join(newSkill, 'SKILL.md'), 'utf8')).toContain('Existing');
  });
  it('restores the old directory and files when writing a renamed skill fails', async () => {
    const oldSkill = path.join(root, '.agents/skills/old-name');
    fs.mkdirSync(oldSkill, { recursive: true });
    const originalSkill = '---\nname: old-name\n---\nOld\n';
    const originalAgents = 'Read `.agents/skills/old-name/SKILL.md`.\n';
    fs.writeFileSync(path.join(oldSkill, 'SKILL.md'), originalSkill);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), originalAgents);
    const writeFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
      if (String(file).endsWith('/.agents/skills/new-name/SKILL.md')) throw new Error('injected write failure');
      return writeFileSync(file, data, options);
    }) as typeof fs.writeFileSync);
    const response = await fetch(`${base}/api/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '.agents/skills/old-name/SKILL.md', slug: 'new-name', content: '---\nname: new-name\n---\nChanged\n' }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'injected write failure' });
    expect(fs.existsSync(oldSkill)).toBe(true);
    expect(fs.existsSync(path.join(root, '.agents/skills/new-name'))).toBe(false);
    expect(fs.readFileSync(path.join(oldSkill, 'SKILL.md'), 'utf8')).toBe(originalSkill);
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe(originalAgents);
  });
  it('reports both the primary rename failure and a rollback failure', async () => {
    const oldSkill = path.join(root, '.agents/skills/old-name');
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.writeFileSync(path.join(oldSkill, 'SKILL.md'), '---\nname: old-name\n---\nOld\n');
    const writeFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
      if (String(file).endsWith('/.agents/skills/new-name/SKILL.md')) throw new Error('injected write failure');
      return writeFileSync(file, data, options);
    }) as typeof fs.writeFileSync);
    const renameSync = fs.renameSync.bind(fs);
    let renameCalls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      renameCalls++;
      if (renameCalls === 2) throw new Error('injected rollback failure');
      return renameSync(oldPath, newPath);
    }) as typeof fs.renameSync);
    const response = await fetch(`${base}/api/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '.agents/skills/old-name/SKILL.md', slug: 'new-name', content: '---\nname: new-name\n---\nChanged\n' }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ rollbackFailed: true, error: expect.stringContaining('injected write failure') });
    expect(renameCalls).toBe(2);
  });
  it('uploads into directories, keeps hash URLs after moves, and restricts deletion to assets', async () => {
    const request = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const uploaded = await fetch(`${base}/api/assets`, request('POST', { notebookId: 'example', filename: 'test.txt', directory: 'projects/images', base64Content: Buffer.from('asset bytes').toString('base64') })).then(r => r.json());
    expect(uploaded.path).toBe('notes/example/assets/projects/images/test.txt');
    expect(uploaded.rawUrl).toMatch(/^\/raw-assets\/by-hash\/[a-f0-9]{40}$/);
    expect(await fetch(base + uploaded.rawUrl).then(r => r.text())).toBe('asset bytes');
    const moved = await fetch(`${base}/api/assets`, request('PATCH', { path: uploaded.path, directory: 'archive' })).then(r => r.json());
    expect(moved.path).toBe('notes/example/assets/archive/test.txt');
    expect(await fetch(base + uploaded.rawUrl).then(r => r.text())).toBe('asset bytes');
    const listed = await fetch(`${base}/api/assets?notebookId=example`).then(r => r.json());
    expect(listed.assets[0]).toMatchObject({ directory: 'archive', rawUrl: uploaded.rawUrl });
    expect((await fetch(`${base}/api/assets?path=notes/example/projects/deep/note.md`, { method: 'DELETE' })).status).toBe(403);
    expect((await fetch(`${base}/api/assets`, request('POST', { notebookId: 'example', filename: 'x.png', directory: '../escape', base64Content: 'eA==' }))).ok).toBe(false);
    expect((await fetch(`${base}/api/assets?path=${encodeURIComponent(moved.path)}`, { method: 'DELETE' })).ok).toBe(true);
    expect((await fetch(base + uploaded.rawUrl)).status).toBe(404);
  });
  it('lists configured folders, creates in nested directories and rejects duplicate creation', async () => {
    const folders = await fetch(`${base}/api/folders`).then(r => r.json());
    expect(folders.folders.map((f: any) => f.path)).toEqual(['projects', 'projects/deep']);
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'notes/example/projects/deep/new.md', content: '# New', createOnly: true, noCommit: true }) };
    expect((await fetch(`${base}/api/notes`, request)).status).toBe(200);
    expect((await fetch(`${base}/api/notes`, request)).status).toBe(409);
    expect(fs.readFileSync(path.join(root, 'notes/example/projects/deep/new.md'), 'utf8')).toBe('# New');
  });
  it('reads and saves notes whose notebook root lives outside the notes/ prefix (multi-repo root workspace)', async () => {
    fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: life\n    title: Life\n    root: my-notes/notes/life\n');
    fs.mkdirSync(path.join(root, 'my-notes/notes/life'), { recursive: true });
    fs.writeFileSync(path.join(root, 'my-notes/notes/life/note.md'), '# Life Note');
    git('add', '.');
    git('commit', '-m', 'add life notebook');
    const read = await fetch(`${base}/api/notes/read?path=my-notes/notes/life/note.md&notebookId=life`).then(r => r.json());
    expect(read.note.content).toBe('# Life Note');
    const saved = await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'my-notes/notes/life/note.md', content: '# Updated Life Note', notebookId: 'life', noCommit: true }) });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'my-notes/notes/life/note.md'), 'utf8')).toBe('# Updated Life Note');
  });
  it('blocks raw secret reads, product-file writes, foreign origins and core branch writes', async () => {
    expect((await fetch(`${base}/raw-assets/.env`)).status).toBe(403);
    expect((await fetch(`${base}/api/notes/read?path=.env`)).status).toBe(403);
    expect((await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'README.md', content: 'bad' }) })).status).toBe(403);
    expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'http://localhost:5173' } })).status).toBe(200);
    expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'http://localhost:5174' } })).status).toBe(200);
    expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'http://127.0.0.1:5199' } })).status).toBe(200);
    expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'https://localhost:5173' } })).status).toBe(403);
    fs.writeFileSync(path.join(root, '.mygitnotes-dev-ports.json'), JSON.stringify({ webPort: 5174 }));
    expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'http://localhost:5174' } })).status).toBe(200);
    expect((await fetch(`${base}/api/workspace`, { headers: { Origin: 'http://localhost:5173' } })).status).toBe(200);
    git('checkout', '-b', 'core');
    expect((await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'notes/example/new.md', content: 'bad' }) })).status).toBe(403);
  });
  it('rejects OAuth callbacks without matching browser state and unauthenticated agent grants', async () => {
    expect((await fetch(`${base}/api/auth/github/callback?state=${'x'.repeat(43)}&code=x`)).status).toBe(400);
    expect((await fetch(`${base}/api/auth/agent-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(503);
  });
  it('saves workspace config back to the legacy-named manifest that was loaded, without creating a duplicate', async () => {
    fs.rmSync(path.join(root, 'notes/.github-notes.yaml'));
    fs.writeFileSync(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
    git('add', '.');
    git('commit', '-m', 'legacy root manifest');
    const updated = 'schema_version: 1\nworkspace:\n  title: Renamed\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n';
    const response = await fetch(`${base}/api/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configYaml: updated }) });
    expect(response.status).toBe(200);
    expect(fs.readFileSync(path.join(root, '.github-notes.yaml'), 'utf8')).toContain('Renamed');
    expect(fs.existsSync(path.join(root, '.mygitnotes.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes/.mygitnotes.yaml'))).toBe(false);
  });
  it('creates a new manifest under the standard filename when the workspace has none yet', async () => {
    fs.rmSync(path.join(root, 'notes/.github-notes.yaml'));
    git('add', '.');
    git('commit', '-m', 'remove manifest');
    const configYaml = 'schema_version: 1\nworkspace:\n  title: Fresh\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n';
    const response = await fetch(`${base}/api/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configYaml }) });
    expect(response.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'notes/.mygitnotes.yaml'), 'utf8')).toContain('Fresh');
  });
});
describe('server-held session records', () => {
  it('encrypts upstream tokens and detects tampering', async () => {
    const record = seal({ token: 'upstream-secret' });
    expect(record).not.toContain('upstream-secret');
    expect(unseal(record).token).toBe('upstream-secret');
    const bytes = Buffer.from(record, 'base64url');
    bytes[15] ^= 1;
    expect(() => unseal(bytes.toString('base64url'))).toThrow();
    const store = new SessionStore(root);
    const id = 'a'.repeat(43);
    await store.set(id, { kind: 'session', token: 'upstream-secret' });
    expect((await store.get(id)).token).toBe('upstream-secret');
    await store.delete(id);
    expect(await store.get(id)).toBe(null);
  });
});

describe('GitHub login and shared agent authorization', () => {
  it('completes PKCE login, keeps credentials server-side, protects private reads and preserves persistent grants until owner revocation', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.stubEnv('GITHUB_NOTES_SOURCE', 'github');
    vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
    vi.stubEnv('GITHUB_CLIENT_ID', 'client');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'client-secret');
    server = createServer(createApp(root));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    vi.stubEnv('APP_URL', base);
    const nativeFetch = globalThis.fetch;
    const manifest = 'schema_version: 1\nworkspace:\n  title: Private\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === 'https://github.com/login/oauth/access_token') {
        const body = JSON.parse(String(init?.body));
        expect(body.code_verifier).toHaveLength(43);
        expect(body.redirect_uri).toBe(`${base}/api/auth/github/callback`);
        return json({ access_token: 'private-upstream-token' });
      }
      if (url === 'https://api.github.com/user') return json({ id: 1, login: 'owner' });
      if (url.startsWith('https://api.github.com/repos/owner/repo')) {
        if (!(init?.headers as any)?.Authorization) return json({}, 404);
        const endpoint = url.replace('https://api.github.com/repos/owner/repo', '');
        if (!endpoint) return json({ private: true, permissions: { push: true } });
        if (endpoint.startsWith('/commits/')) return json({ sha: 'head', commit: { tree: { sha: 'tree' } } });
        if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: [{ path: 'notes/.github-notes.yaml', sha: 'manifest', type: 'blob', mode: '100644' }, { path: 'notes/ex/private.md', sha: 'note', type: 'blob', mode: '100644' }, { path: 'AGENTS.md', sha: 'agents', type: 'blob', mode: '100644' }, { path: '.agents/skills/demo/SKILL.md', sha: 'skill', type: 'blob', mode: '100644' }] });
        if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(endpoint.endsWith('manifest') ? manifest : endpoint.endsWith('agents') ? '# Workspace rules' : endpoint.endsWith('skill') ? '---\ndescription: Demo skill\n---\nDemo body' : '# Private Note').toString('base64') });
      }
      return nativeFetch(input, init);
    });
    try {
      expect((await fetch(`${base}/api/notes`)).status).toBe(404);
      expect((await fetch(`${base}/api/notes/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
      const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
      expect(start.status).toBe(302);
      const location = new URL(start.headers.get('location')!);
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('scope')).toBe('repo workflow');
      const oauthCookie = start.headers.get('set-cookie')!.split(';')[0];
      const callback = await fetch(`${base}/api/auth/github/callback?state=${location.searchParams.get('state')}&code=test`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
      expect(callback.status).toBe(302);
      const sessionHeader = callback.headers.getSetCookie().find(value => value.startsWith('gh_notes_session='))!;
      expect(sessionHeader).toContain('HttpOnly');
      expect(sessionHeader).not.toContain('private-upstream-token');
      const cookie = sessionHeader.split(';')[0];
      const notes = await fetch(`${base}/api/notes`, { headers: { Cookie: cookie } }).then(r => r.json());
      expect(notes.notes[0].title).toBe('Private Note');
      const grantResponse = await fetch(`${base}/api/auth/agent-token`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ write: false }) });
      const grant = await grantResponse.json();
      expect(grant.expiresIn).toBeNull();
      expect(grant.url).toBe(`${base}/mcp/${grant.token}`);
      expect(grant.token).toHaveLength(43);
      expect(grant.token).not.toBe('private-upstream-token');
      const call = { method: 'POST', headers: { Connection: 'close', Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) };
      const listed = await fetch(`${base}/mcp`, call);
      expect(listed.status).toBe(200);
      expect(listed.headers.get('cache-control')).toBe('private, no-store');
      const listedBody = await listed.json();
      expect(listedBody.result.tools.some((t: any) => t.name === 'save_note')).toBe(false);
      const urlCall = { ...call, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Connection: 'close' } };
      const viaUrl = await fetch(grant.url, urlCall);
      expect(viaUrl.status).toBe(200);
      expect(viaUrl.headers.get('cache-control')).toBe('private, no-store');
      const client = new Client({ name: 'connector-schema-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(grant.url)));
      try {
        const { tools } = await client.listTools();
        expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['ls', 'glob', 'read', 'find', 'get_statuses', 'read_note', 'search_notes']));
        expect(tools.every(t => t.annotations?.readOnlyHint === true && t.inputSchema && t.outputSchema)).toBe(true);
        for (const name of ['write', 'append', 'edit', 'mkdir', 'cp', 'mv', 'rm', 'save_note', 'delete_note', 'add_asset', 'delete_asset', 'replace_notes', 'update_note_metadata']) expect(tools.some(t => t.name === name)).toBe(false);
        // The SDK validates structuredContent against each advertised output schema.
        for (const [name, args] of [['read', { path: 'notes/ex/private.md' }], ['glob', {}], ['find', { query: 'Private' }], ['read_note', { path: 'notes/ex/private.md' }], ['get_statuses', {}], ['get_note_metadata', { path: 'notes/ex/private.md' }], ['search_notes', { query: 'Private' }], ['get_system_prompt', { notebookId: 'ex' }], ['list_skills', {}], ['invoke_skill', { name: 'demo' }], ['read', { path: '.agents/skills/demo/SKILL.md' }]] as const) {
          const result = await client.callTool({ name, arguments: args });
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toBeDefined();
        }
        expect((await client.callTool({ name: 'read', arguments: { path: 'notes/ex/private.md' } })).structuredContent).toMatchObject({ hint: expect.stringContaining('get_system_prompt') });
        expect((await client.callTool({ name: 'read_note', arguments: { path: 'notes/ex/private.md' } })).structuredContent).toMatchObject({ hint: expect.stringContaining('list_skills') });
        expect((await client.callTool({ name: 'read', arguments: { path: '.agents/skills/demo/SKILL.md' } })).structuredContent).not.toHaveProperty('hint');
        expect((await client.callTool({ name: 'get_system_prompt', arguments: { path: 'notes/ex/private.md' } })).structuredContent).toMatchObject({ target: 'notes/ex', content: '# Workspace rules' });
        expect((await client.callTool({ name: 'invoke_skill', arguments: { name: 'demo' } })).structuredContent).toMatchObject({ description: 'Demo skill', content: 'Demo body', files: [] });
      } finally {
        await client.close();
      }
      const denied = await fetch(`${base}/mcp`, { ...call, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'save_note', arguments: { path: 'notes/ex/private.md', content: 'bad', revision: 'head' } } }) }).then(r => r.json());
      expect(denied.result.isError).toBe(true);
      const store = new SessionStore(root);
      const grants = await fetch(`${base}/api/auth/agent-tokens`, { headers: { Cookie: cookie } }).then(r => r.json());
      expect(grants.grants[0]).toMatchObject({ id: grant.id, write: false, expiresAt: null });
      expect(JSON.stringify(grants)).not.toContain(grant.token);
      expect(JSON.stringify(grants)).not.toContain('private-upstream-token');
      const legacy = 'l'.repeat(43);
      await store.set(legacy, { kind: 'agent', session: cookie.split('=')[1], source: 'github:owner/repo@main', audience: `${base}/mcp`, write: false }, 8 * 3600);
      const legacyCall = { ...call, headers: { ...call.headers, Authorization: `Bearer ${legacy}` } };
      expect((await fetch(`${base}/mcp`, legacyCall)).status).toBe(200);
      await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
      expect((await fetch(`${base}/mcp`, call)).status).toBe(200);
      expect((await fetch(`${base}/mcp`, legacyCall)).status).toBe(401);
      expect((await fetch(`${base}/api/notes`, { headers: { Cookie: cookie } })).status).toBe(404);
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 24 * 3600 * 1000);
      await new Promise<void>(resolve => server.close(() => resolve()));
      server = createServer(createApp(root));
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as any).port}`;
      const stillReadable = await fetch(`${base}/mcp`, { ...call, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'notes/ex/private.md' } } }) }).then(r => r.json());
      expect(stillReadable.result.isError).not.toBe(true);
      expect(stillReadable.result.content[0].text).toContain('Private Note');
      const other = 'o'.repeat(43);
      await store.set(other, { kind: 'session', userId: 2, token: 'other-token' });
      expect((await fetch(`${base}/api/auth/agent-tokens/${grant.id}`, { method: 'DELETE', headers: { Cookie: `gh_notes_session=${other}` } })).status).toBe(404);
      expect((await fetch(`${base}/mcp`, call)).status).toBe(200);
      const owner = 'n'.repeat(43);
      await store.set(owner, { kind: 'session', userId: 1, token: 'private-upstream-token' });
      expect((await fetch(`${base}/api/auth/agent-tokens/${grant.id}`, { method: 'DELETE', headers: { Cookie: `gh_notes_session=${owner}` } })).status).toBe(200);
      expect((await fetch(`${base}/mcp`, call)).status).toBe(401);
      expect((await fetch(`${base}/mcp/${grant.token}`, urlCall)).status).toBe(401);
      expect((await fetch(`${base}/api/auth/agent-tokens`, { headers: { Cookie: `gh_notes_session=${owner}` } }).then(r => r.json())).grants).toEqual([]);
    } finally {
      mock.mockRestore();
    }
  });

  it('refreshes a short-lived GitHub credential once for concurrent grant calls and keeps long-lived credentials as issued', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.stubEnv('GITHUB_NOTES_SOURCE', 'github');
    vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
    vi.stubEnv('GITHUB_CLIENT_ID', 'client');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'client-secret');
    server = createServer(createApp(root));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    vi.stubEnv('APP_URL', base);
    const nativeFetch = globalThis.fetch;
    let refreshes = 0;
    const upstreamTokens = new Set<string>();
    const manifest = 'schema_version: 1\nworkspace:\n  title: Private\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === 'https://github.com/login/oauth/access_token') {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ client_id: 'client', client_secret: 'client-secret' });
        if (body.grant_type === 'refresh_token') {
          refreshes++;
          expect(body.refresh_token).toBe('github-refresh');
          expect(body.redirect_uri).toBeUndefined();
          return json({ access_token: 'refreshed-github-token', refresh_token: 'rotated-github-refresh', expires_in: 28800, refresh_token_expires_in: 15897600 });
        }
        return json({ access_token: 'short-lived-token', refresh_token: 'github-refresh', expires_in: 28800, refresh_token_expires_in: 15897600 });
      }
      if (url === 'https://api.github.com/user') return json({ id: 1, login: 'owner' });
      if (url.startsWith('https://api.github.com/repos/owner/repo')) {
        const authorization = String((init?.headers as any)?.Authorization || '');
        upstreamTokens.add(authorization);
        if (authorization !== 'Bearer refreshed-github-token') return json({ message: 'Bad credentials' }, 401);
        const endpoint = url.replace('https://api.github.com/repos/owner/repo', '');
        if (!endpoint) return json({ private: true, permissions: { push: true } });
        if (endpoint.startsWith('/commits/')) return json({ sha: 'head', commit: { tree: { sha: 'tree' } } });
        if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: [{ path: 'notes/.github-notes.yaml', sha: 'manifest', type: 'blob', mode: '100644' }, { path: 'notes/ex/private.md', sha: 'note', type: 'blob', mode: '100644' }] });
        if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(endpoint.endsWith('manifest') ? manifest : '# Private Note').toString('base64') });
      }
      return nativeFetch(input, init);
    });
    const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
    const location = new URL(start.headers.get('location')!);
    const callback = await fetch(`${base}/api/auth/github/callback?state=${location.searchParams.get('state')}&code=test`, { redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie')!.split(';')[0] } });
    const cookie = callback.headers.getSetCookie().find(value => value.startsWith('gh_notes_session='))!.split(';')[0];
    const grant = await fetch(`${base}/api/auth/agent-token`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ write: false }) }).then(r => r.json());
    const store = new SessionStore(root);
    const { credential } = await store.get(grant.token);
    const issued = await store.get(credential);
    expect(issued).toMatchObject({ token: 'short-lived-token', refreshToken: 'github-refresh' });
    expect(await credentialToken(root, credential)).toBe('short-lived-token');
    expect(refreshes).toBe(0);
    await store.set(credential, { ...issued, upstreamExpiresAt: Date.now() - 1000 }, null);
    const read = (id: number) => fetch(grant.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'notes/ex/private.md' } } }) });
    const results = await Promise.all([read(1), read(2)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    for (const result of await Promise.all(results.map(r => r.json()))) {
      expect(result.result.isError).not.toBe(true);
      expect(result.result.content[0].text).toContain('Private Note');
    }
    expect(refreshes).toBe(1);
    expect([...upstreamTokens]).toEqual(['Bearer refreshed-github-token']);
    expect(await store.get(credential)).toMatchObject({ token: 'refreshed-github-token', refreshToken: 'rotated-github-refresh' });
    await store.set(credential, { ...issued, refreshToken: undefined, upstreamExpiresAt: Date.now() - 1000 }, null);
    const expired = await read(3);
    expect(expired.status).toBe(401);
    expect((await expired.json()).error).toContain('Authorization expired');
    await store.set(credential, { ...issued, refreshToken: undefined, upstreamExpiresAt: undefined }, null);
    expect(await credentialToken(root, credential)).toBe('short-lived-token');
    expect(refreshes).toBe(1);
  });

  it('logs a secret-free reason for each rejected grant or credential', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.stubEnv('GITHUB_NOTES_SOURCE', 'github');
    vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
    vi.stubEnv('GITHUB_CLIENT_ID', 'client');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'client-secret');
    server = createServer(createApp(root));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    vi.stubEnv('APP_URL', base);
    const nativeFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      if (url === 'https://github.com/login/oauth/access_token') return json({ access_token: 'long-lived-token' });
      if (url === 'https://api.github.com/user') return json({ id: 1, login: 'owner' });
      return nativeFetch(input, init);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logged: string[] = [];
    const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
    const location = new URL(start.headers.get('location')!);
    const callback = await fetch(`${base}/api/auth/github/callback?state=${location.searchParams.get('state')}&code=test`, { redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie')!.split(';')[0] } });
    const cookie = callback.headers.getSetCookie().find(value => value.startsWith('gh_notes_session='))!.split(';')[0];
    const grant = await fetch(`${base}/api/auth/agent-token`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ write: false }) }).then(r => r.json());
    const store = new SessionStore(root);
    const { credential } = await store.get(grant.token);
    const issued = await store.get(credential);
    const reasons = async (url: string) => {
      warn.mockClear();
      const { status } = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      const messages = warn.mock.calls.map(call => String(call[0]));
      logged.push(...messages);
      return [status, ...messages];
    };
    expect(await reasons(`${base}/mcp`)).toEqual([401, '[mcp] unauthorized: no-token']);
    expect(await reasons(`${base}/mcp/${'u'.repeat(43)}`)).toEqual([401, '[mcp] unauthorized: grant-missing']);
    await store.delete(credential);
    expect(await reasons(grant.url)).toEqual([401, '[auth] credential rejected: missing']);
    await store.set(credential, { ...issued, realm: 'github:https://github.com:other-client' }, null);
    expect(await reasons(grant.url)).toEqual([401, '[auth] credential rejected: realm']);
    await store.set(credential, { ...issued, upstreamExpiresAt: Date.now() - 1000 }, null);
    expect(await reasons(grant.url)).toEqual([401, '[auth] credential rejected: expired']);
    vi.stubEnv('SESSION_SECRET', 't'.repeat(64));
    await store.set(credential, issued, null);
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    expect(await reasons(grant.url)).toEqual([401, expect.stringMatching(/^\[auth\] record [a-f0-9]{8} sealed with another SESSION_SECRET$/), '[auth] credential rejected: sealed-elsewhere']);
    await store.set(credential, issued, null);
    expect(await reasons(grant.url)).toEqual([200]);
    for (const secret of [grant.token, credential, 'long-lived-token', 's'.repeat(64)]) expect(logged.join('\n')).not.toContain(secret);
  });
  it('keeps the last rejection of each grant for seven days on the grant list', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.stubEnv('GITHUB_NOTES_SOURCE', 'github');
    vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
    vi.stubEnv('GITHUB_CLIENT_ID', 'client');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'client-secret');
    server = createServer(createApp(root));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    vi.stubEnv('APP_URL', base);
    const nativeFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      if (url === 'https://github.com/login/oauth/access_token') return json({ access_token: 'long-lived-token' });
      if (url === 'https://api.github.com/user') return json({ id: 1, login: 'owner' });
      return nativeFetch(input, init);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
    const location = new URL(start.headers.get('location')!);
    const callback = await fetch(`${base}/api/auth/github/callback?state=${location.searchParams.get('state')}&code=test`, { redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie')!.split(';')[0] } });
    const cookie = callback.headers.getSetCookie().find(value => value.startsWith('gh_notes_session='))!.split(';')[0];
    const grant = await fetch(`${base}/api/auth/agent-token`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ write: false }) }).then(r => r.json());
    const store = new SessionStore(root);
    const { credential } = await store.get(grant.token);
    const issued = await store.get(credential);
    const call = (url: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then(r => r.status);
    const last = async () => (await fetch(`${base}/api/auth/agent-tokens`, { headers: { Cookie: cookie } }).then(r => r.json())).grants[0].lastRejection;
    expect(await last()).toBeNull();
    const before = Date.now();
    await store.delete(credential);
    expect(await call(grant.url)).toBe(401);
    expect(await last()).toEqual({ reason: 'missing', at: expect.any(Number) });
    expect((await last()).at).toBeGreaterThanOrEqual(before);
    vi.stubEnv('SESSION_SECRET', 't'.repeat(64));
    await store.set(credential, issued, null);
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    expect(await call(grant.url)).toBe(401);
    expect((await last()).reason).toBe('sealed-elsewhere');
    await store.set(credential, issued, null);
    vi.stubEnv('APP_URL', 'https://moved.example');
    expect(await call(grant.url)).toBe(401);
    expect((await last()).reason).toBe('grant-audience');
    vi.stubEnv('APP_URL', base);
    expect(await call(grant.url)).toBe(200);
    expect((await last()).reason).toBe('grant-audience');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 24 * 60 * 60 * 1000 + 1000);
    expect(await last()).toBeNull();
  });
});

describe('durable Redis grant records', () => {
  it('stores grants without TTL and removes the owner index on revocation', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    const records = new Map<string, string>();
    const members = new Set<string>();
    const commands: string[][] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const c = JSON.parse(String(init?.body));
      commands.push(c);
      let result: unknown = null;
      if (c[0] === 'SET') {
        records.set(c[1], c[2]);
        result = 'OK';
      }
      if (c[0] === 'GET') result = records.get(c[1]) || null;
      if (c[0] === 'DEL') {
        records.delete(c[1]);
        result = 1;
      }
      if (c[0] === 'SADD') {
        members.add(c[2]);
        result = 1;
      }
      if (c[0] === 'SREM') {
        members.delete(c[2]);
        result = 1;
      }
      if (c[0] === 'SMEMBERS') result = [...members];
      return new Response(JSON.stringify({ result }));
    });
    const store = new SessionStore(root);
    const token = 't'.repeat(43);
    await store.set(token, { kind: 'agent', ownerId: 1, name: 'Test', createdAt: Date.now(), write: false, source: 'github:owner/repo@main' }, null);
    await store.indexGrant(token, 1);
    expect(commands.find(c => c[0] === 'SET')).toHaveLength(3);
    expect([...records.values()][0]).not.toContain('ownerId');
    const grants = await store.listGrants(1);
    expect(grants).toHaveLength(1);
    expect(await store.revokeGrant(grants[0].id, 2)).toBe(false);
    expect(await store.revokeGrant(grants[0].id, 1)).toBe(true);
    expect(await store.get(token)).toBeNull();
    expect(members.size).toBe(0);
    await store.set(token, { kind: 'oauth' }, 600);
    expect(commands.filter(c => c[0] === 'SET').at(-1)?.slice(-2)).toEqual(['EX', '600']);
  });
  it('leaves records sealed by another deployment sharing the Redis keyspace untouched', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    const records = new Map<string, string>();
    const members = new Set<string>();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const c = JSON.parse(String(init?.body));
      let result: unknown = null;
      if (c[0] === 'SET') {
        records.set(c[1], c[2]);
        result = 'OK';
      }
      if (c[0] === 'GET') result = records.get(c[1]) || null;
      if (c[0] === 'DEL') {
        records.delete(c[1]);
        result = 1;
      }
      if (c[0] === 'SADD') {
        members.add(c[2]);
        result = 1;
      }
      if (c[0] === 'SREM') {
        members.delete(c[2]);
        result = 1;
      }
      if (c[0] === 'SMEMBERS') result = [...members];
      return new Response(JSON.stringify({ result }));
    });
    const token = 'o'.repeat(43), stale = 'b'.repeat(64);
    vi.stubEnv('SESSION_SECRET', 'other'.repeat(8));
    const other = new SessionStore(root);
    await other.set(token, { kind: 'agent', ownerId: 1, name: 'Other connector', createdAt: Date.now() }, null);
    await other.indexGrant(token, 1);
    members.add(stale);
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    const store = new SessionStore(root);
    expect(await store.listGrants(1)).toEqual([]);
    expect(await store.get(token)).toBeNull();
    expect(members.has(stale)).toBe(false);
    vi.stubEnv('SESSION_SECRET', 'other'.repeat(8));
    expect((await other.listGrants(1)).map(grant => grant.name)).toEqual(['Other connector']);
  });
  it('fails without SESSION_SECRET and leaves stored records in place', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    const records = new Map<string, string>();
    const members = new Set<string>();
    const commands: string[][] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const c = JSON.parse(String(init?.body));
      commands.push(c);
      let result: unknown = null;
      if (c[0] === 'SET') {
        records.set(c[1], c[2]);
        result = 'OK';
      }
      if (c[0] === 'GET') result = records.get(c[1]) || null;
      if (c[0] === 'SADD') {
        members.add(c[2]);
        result = 1;
      }
      if (c[0] === 'SMEMBERS') result = [...members];
      return new Response(JSON.stringify({ result }));
    });
    const token = 'g'.repeat(43), store = new SessionStore(root);
    await store.set(token, { kind: 'agent', ownerId: 1, name: 'Kept', createdAt: Date.now() }, null);
    await store.indexGrant(token, 1);
    vi.stubEnv('SESSION_SECRET', '');
    await expect(store.get(token)).rejects.toThrow('SESSION_SECRET');
    await expect(store.listGrants(1)).rejects.toThrow('SESSION_SECRET');
    expect(commands.some(c => c[0] === 'DEL' || c[0] === 'SREM')).toBe(false);
    expect(records.size).toBe(1);
  });
});

describe('agent resources discovery and security boundaries', () => {
  it('discovers and edits root and notebook workspace guidelines', async () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Root Workspace Guidelines\n');
    fs.writeFileSync(path.join(root, 'notes/AGENTS.md'), '# Workspace Guidelines\n');

    const res = await fetch(`${base}/api/agent-resources`).then((r) => r.json());
    expect(res.instructions).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'AGENTS.md', scope: 'workspace', editable: true }), expect.objectContaining({ path: 'notes/AGENTS.md', scope: 'notes', editable: true })]));

    const rootDoc = await fetch(`${base}/api/agent-resources/read?path=AGENTS.md`).then((r) => r.json());
    expect(rootDoc.content).toBe('# Root Workspace Guidelines\n');

    const saveRoot = await fetch(`${base}/api/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'AGENTS.md', content: 'attempted overwrite' }) });
    expect(saveRoot.status).toBe(200);

    const saveWorkspace = await fetch(`${base}/api/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'notes/AGENTS.md', content: '# Updated Workspace Guidelines\n' }) });
    expect(saveWorkspace.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'notes/AGENTS.md'), 'utf8')).toBe('# Updated Workspace Guidelines\n');
  });
});
