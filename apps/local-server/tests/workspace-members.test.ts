import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { deploymentConfigSource } from '@mygitnotes/core';
import { callWorkspaceRemoteTool } from '@mygitnotes/mcp-server';
import { createApp } from '../src/app.js';
import { createRecordStore } from '../src/record-store/index.js';
import { openWorkspace, prewarmLocalScans, type RemoteHandle } from '../src/request-workspace.js';
import { chosenRepositorySource, type WorkspaceChoices } from '../src/workspace-choice.js';
import { worktreeSubscriberCount } from '../src/worktree-watch.js';

const manifest = (title: string, id: string) => `schema_version: 4\nworkspace:\n  title: ${title}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${title}\n    root: notes/${id}\n`;
const roots: string[] = [];
let server: Server | undefined, base = '';
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const scratch = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-members-')));
  roots.push(root);
  return root;
};
/** A committed worktree at `dir/name` with one note, and a manifest unless `bare`. */
const worktree = (dir: string, name: string, bare = false) => {
  const root = path.join(dir, name);
  fs.mkdirSync(path.join(root, 'notes', name), { recursive: true });
  if (!bare) fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), manifest(name, name));
  fs.writeFileSync(path.join(root, 'notes', name, 'note.md'), `# ${name} note\n`);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture');
  return root;
};
const listen = async (app: Parameters<typeof createServer>[1]) => {
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.status === 405 && !response.headers.get('content-type')?.includes('json') ? {} : await response.json() };
};
const settle = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));

describe('Settings → Repositories in a local deployment', () => {
  const start = async () => {
    const product = scratch();
    const kb = worktree(product, 'kb'), trpg = worktree(product, 'trpg'), journal = worktree(product, 'journal');
    const file = path.join(product, 'mygitnotes.server.yaml');
    fs.writeFileSync(file, `# Worktrees on this machine.\nrepositories:\n  - type: local\n    path: ./trpg # the campaign\n`);
    for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: kb, VERCEL: '', APP_URL: '' })) vi.stubEnv(key, value);
    await listen(createApp(product));
    return { product, kb, trpg, journal, file };
  };
  const members = async () => (await call('GET', '/api/workspace/members')).body;
  const idOf = async (alias: string) => (await members()).members.find((member: { alias: string; }) => member.alias === alias).id;
  const noteTitles = async () => (await call('GET', '/api/notes/query?notebookId=all&limit=50')).body.notes.map((note: { title: string; }) => note.title).sort();

  it('lists every member without opening a repository, and adds, hides, shows and makes the default by rewriting the file', async () => {
    const { file, journal, trpg } = await start();
    // A member whose worktree is gone is still listed.
    fs.renameSync(trpg, `${trpg}-moved`);
    let list = await members();
    expect(list).toMatchObject({ changeable: true, sharedAssetKeys: false, revision: expect.stringMatching(/^sha256:/), environment: 'MYGITNOTES_LOCAL_PATH' });
    expect(list.members.map((member: { alias: string; default: boolean; hidden: boolean; editable: string; }) => [member.alias, member.default, member.hidden, member.editable])).toEqual([['kb', true, false, 'environment'], ['trpg', false, false, 'server-file']]);
    fs.renameSync(`${trpg}-moved`, trpg);

    let { body } = await call('POST', '/api/workspace/members', { path: journal, revision: list.revision });
    expect(body.revision).toMatch(/^sha256:/);
    expect(await noteTitles()).toEqual(['journal note', 'kb note', 'trpg note']);
    ({ body } = await call('PATCH', '/api/workspace/members', { repository: await idOf('journal'), hidden: true, revision: body.revision }));
    // Hidden, its notebooks, notes and repository appear nowhere but in the member list.
    expect(await noteTitles()).toEqual(['kb note', 'trpg note']);
    expect((await call('GET', '/api/workspace')).body.repositories.map((repository: { alias: string; }) => repository.alias)).toEqual(['kb', 'trpg']);
    expect((await call('GET', '/api/notes/read?path=notes/journal/note.md&notebookId=journal~journal')).status).toBe(404);
    list = await members();
    expect(list.members.find((member: { alias: string; }) => member.alias === 'journal')).toMatchObject({ hidden: true, path: journal });
    ({ body } = await call('PATCH', '/api/workspace/members', { repository: await idOf('journal'), hidden: false, revision: list.revision }));
    expect(await noteTitles()).toEqual(['journal note', 'kb note', 'trpg note']);
    ({ body } = await call('PATCH', '/api/workspace/members', { repository: await idOf('trpg'), default: true, revision: body.revision }));
    expect((await call('GET', '/api/workspace')).body.defaultRepository).toBe(await idOf('trpg'));
    ({ body } = await call('PUT', '/api/workspace/members/order', { order: [await idOf('journal'), await idOf('trpg'), await idOf('kb')], revision: body.revision }));
    expect((await members()).members.map((member: { alias: string; }) => member.alias)).toEqual(['journal', 'trpg', 'kb']);
    expect(fs.readFileSync(file, 'utf8')).toContain('# Worktrees on this machine.\nrepositories:\n');
    expect(fs.readFileSync(file, 'utf8')).toContain('path: ./trpg # the campaign\n');
  });

  it('refuses to hide or remove the default, removes the environment member never, and a stale change not at all', async () => {
    const { file } = await start();
    const { revision } = await members();
    const refusal = await call('PATCH', '/api/workspace/members', { repository: await idOf('kb'), hidden: true, revision });
    expect(refusal).toMatchObject({ status: 422, body: { code: 'default-hidden' } });
    expect(await call('DELETE', `/api/workspace/members?repository=${encodeURIComponent(await idOf('kb'))}&revision=${encodeURIComponent(revision)}`)).toMatchObject({ status: 422, body: { code: 'environment', error: expect.stringContaining('MYGITNOTES_LOCAL_PATH') } });
    let { body } = await call('PATCH', '/api/workspace/members', { repository: await idOf('trpg'), default: true, revision });
    expect(await call('DELETE', `/api/workspace/members?repository=${encodeURIComponent(await idOf('trpg'))}&revision=${encodeURIComponent(body.revision)}`)).toMatchObject({ status: 422, body: { code: 'default-removed' } });
    // The file changed since this page read it: the change is refused and the file stays as it is.
    const before = fs.readFileSync(file, 'utf8');
    expect(await call('PATCH', '/api/workspace/members', { repository: await idOf('trpg'), hidden: true, revision })).toMatchObject({ status: 409, body: { code: 'stale' } });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    ({ body } = await call('PATCH', '/api/workspace/members', { repository: await idOf('kb'), default: true, revision: body.revision }));
    expect((await call('DELETE', `/api/workspace/members?repository=${encodeURIComponent(await idOf('trpg'))}&revision=${encodeURIComponent(body.revision)}`)).status).toBe(200);
    expect((await members()).members.map((member: { alias: string; }) => member.alias)).toEqual(['kb']);
  });

  it('asks for the folder of a worktree without a manifest and serves one notebook there', async () => {
    const { product } = await start();
    const scraps = worktree(product, 'scraps', true);
    const { revision } = await members();
    expect(await call('POST', '/api/workspace/members', { path: scraps, revision })).toMatchObject({ status: 422, body: { code: 'folder-required' } });
    expect((await call('POST', '/api/workspace/members', { path: scraps, folder: 'notes/scraps', revision })).status).toBe(200);
    const workspace = (await call('GET', '/api/workspace')).body;
    expect(workspace.repositories.find((repository: { alias: string; }) => repository.alias === 'scraps')).toMatchObject({ notebooks: ['scraps~scraps'], manifest: 'derived' });
    expect(await noteTitles()).toContain('scraps note');
  });

  it('stops watching a worktree once it is hidden, ending every open stream so pages reconnect', async () => {
    const { trpg } = await start();
    const open = async () => {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/workspace/events`, { signal: controller.signal });
      const reader = response.body!.getReader();
      await reader.read();
      return { controller, reader };
    };
    const first = await open();
    await settle();
    expect(worktreeSubscriberCount(trpg)).toBe(1);
    const { revision } = await members();
    expect((await call('PATCH', '/api/workspace/members', { repository: await idOf('trpg'), hidden: true, revision })).status).toBe(200);
    // The server ended the stream; a page's EventSource reconnects and watches only what is visible.
    let done = false;
    while (!done) done = (await first.reader.read()).done;
    await settle();
    expect(worktreeSubscriberCount(trpg)).toBe(0);
    const second = await open();
    await settle();
    expect(worktreeSubscriberCount(trpg)).toBe(0);
    second.controller.abort();
  });

  it('never scans a hidden worktree to warm the server', async () => {
    const { product, journal } = await start();
    fs.appendFileSync(path.join(product, 'mygitnotes.server.yaml'), `  - type: local\n    path: ${journal}\n    hidden: true\n`);
    const readdir = vi.spyOn(fs, 'readdirSync');
    const read = vi.spyOn(fs, 'readFileSync');
    await prewarmLocalScans(deploymentConfigSource(product));
    const touched = [...readdir.mock.calls, ...read.mock.calls].map(([target]) => String(target));
    expect(touched.some(target => target.startsWith(path.join(product, 'kb')))).toBe(true);
    expect(touched.filter(target => target.startsWith(journal))).toEqual([]);
  });
});

describe('Settings → Repositories on a hosted community deployment', () => {
  const session = 'c'.repeat(43);
  it('lists the members read-only and refuses every change on the server', async () => {
    const product = scratch();
    const file = path.join(product, 'mygitnotes.server.yaml');
    fs.writeFileSync(file, 'repositories:\n  - { type: github, repository: owner/trpg, branch: main, hidden: true }\n');
    for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/kb', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '' })) vi.stubEnv(key, value);
    const provider = vi.spyOn(globalThis, 'fetch');
    await listen(createApp(product));
    const list = await call('GET', '/api/workspace/members');
    expect(list.body).toMatchObject({ changeable: false, revision: null });
    expect(list.body.repositoryChoice).toBeUndefined();
    expect(list.body.members.map((member: { alias: string; hidden: boolean; editable: string; branch: string; }) => [member.alias, member.hidden, member.editable, member.branch])).toEqual([['kb', false, 'none', 'main'], ['trpg', true, 'none', 'main']]);
    // The list made no request beyond this test's own.
    expect(provider.mock.calls.filter(([url]) => !String(url).startsWith(base))).toEqual([]);
    const before = fs.readFileSync(file, 'utf8');
    for (const [method, url, body] of [['POST', '/api/workspace/members', { path: '/tmp', revision: 'none' }], ['PATCH', '/api/workspace/members', { repository: 'github:owner/trpg@main', hidden: false, revision: 'none' }], ['PUT', '/api/workspace/members/order', { order: [], revision: 'none' }], ['DELETE', '/api/workspace/members?repository=github%3Aowner%2Ftrpg%40main&revision=none', undefined]] as const) {
      expect(await call(method, url, body, { Cookie: `gh_notes_session=${session}` })).toMatchObject({ status: 405, body: { code: 'read-only' } });
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it("shows a visitor-choice deployment's one member, the visitor's repository, read-only", async () => {
    const product = scratch();
    for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: '', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '' })) vi.stubEnv(key, value);
    const choices: WorkspaceChoices = { read: async () => ({ repository: 'visitor/notes', branch: 'main' }), write: async () => undefined, clear: async () => undefined, signedOut: async () => undefined };
    await listen(createApp(product, { configSource: chosenRepositorySource(product, process.env, choices), workspaceChoices: choices }));
    const list = (await call('GET', '/api/workspace/members')).body;
    expect(list).toMatchObject({ changeable: false, repositoryChoice: true, members: [{ id: 'github:visitor/notes@main', alias: 'notes', default: true, hidden: false, editable: 'none' }] });
    const refused = await call('PATCH', '/api/workspace/members', { repository: 'github:visitor/notes@main', hidden: true, revision: 'none' });
    expect(refused).toMatchObject({ status: 405, body: { code: 'read-only', error: expect.stringContaining('Switch repository') } });
  });
});

describe('a hidden member of a hosted workspace', () => {
  const session = 'c'.repeat(43);
  const repositories: Record<string, { head: string; files: Record<string, string>; }> = { 'owner/kb': { head: 'a'.repeat(40), files: { '.mygitnotes.yaml': manifest('KB', 'life'), 'notes/life/note.md': '# KB note\n\nshared words\n' } }, 'owner/vault': { head: 'b'.repeat(40), files: { '.mygitnotes.yaml': manifest('Vault', 'life'), 'notes/life/note.md': '# Vault note\n\nshared words\n' } } };
  it('is never requested from the provider, whatever the page or MCP call', async () => {
    const product = scratch();
    fs.writeFileSync(path.join(product, 'mygitnotes.server.yaml'), 'repositories:\n  - { type: github, repository: owner/vault, branch: main, hidden: true }\n');
    for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/kb', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', APP_URL: '', VERCEL: '' })) vi.stubEnv(key, value);
    await createRecordStore(product).set(session, { kind: 'session', token: 'fixture-owner', userId: 1 });
    const requested: string[] = [];
    const nativeFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/?]+)(.*)$/.exec(String(url));
      if (!match) return nativeFetch(url, init);
      const [, name, endpoint] = match;
      requested.push(name);
      const repository = repositories[name];
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      if (!repository) return json({ message: 'Not Found' }, 404);
      if (endpoint === '') return json({ private: true, default_branch: 'main', permissions: { push: true } });
      if (endpoint.startsWith('/commits/')) return json({ sha: repository.head, commit: { tree: { sha: `${name}-tree` } } });
      if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: [{ path: 'notes', sha: `${name}:notes`, type: 'tree', mode: '040000' }, { path: 'notes/life', sha: `${name}:notes/life`, type: 'tree', mode: '040000' }, ...Object.entries(repository.files).map(([file, text]) => ({ path: file, sha: `${name}:${file}`, type: 'blob', mode: '100644', size: Buffer.byteLength(text) }))] });
      if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(repository.files[decodeURIComponent(endpoint.slice('/git/blobs/'.length)).slice(name.length + 1)] ?? '').toString('base64') });
      return json({});
    });
    await listen(createApp(product));
    const headers = { Cookie: `gh_notes_session=${session}` };
    const get = (url: string) => call('GET', url, undefined, headers);
    const workspace = (await get('/api/workspace')).body;
    expect(workspace.repositories.map((repository: { alias: string; }) => repository.alias)).toEqual(['kb']);
    expect((await get('/api/workspace?fresh=1')).status).toBe(200);
    const all = (await get('/api/notes/query?notebookId=all&limit=50&content=1')).body;
    expect(all.notes.map((note: { title: string; }) => note.title)).toEqual(['KB note']);
    expect((await get('/api/notes/query?notebookId=all&text=shared&limit=50')).body.notes.map((note: { notebookId: string; }) => note.notebookId)).toEqual(['kb~life']);
    for (const url of ['/api/notes/facets', '/api/notes/graph', '/api/notes/agenda?notebookId=kb~life', '/api/folders', '/api/assets', '/api/focus-page', '/api/agent-resources/workspaces']) expect([url, (await get(url)).status]).toEqual([url, 200]);
    expect((await call('POST', '/api/notes/lookup', { notes: [{ notebookId: 'kb~life', path: 'notes/life/note.md' }] }, headers)).status).toBe(200);
    // The hidden repository's own notebook is not found, and nothing asks the provider for it.
    expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=vault~life')).status).toBe(404);
    expect((await get('/api/assets?notebookId=vault~life')).status).toBe(404);
    // An MCP call opens the workspace the same way /mcp does.
    const settings = await deploymentConfigSource(product).settings({ headers: {} });
    const mcp = openWorkspace(settings, 'fixture-owner') as unknown as import('@mygitnotes/core').WorkspaceRepositories<RemoteHandle>;
    expect(((await callWorkspaceRemoteTool(mcp, 'list_notebooks', {}, false)).notebooks as { key: string; }[]).map(notebook => notebook.key)).toEqual(['kb~life']);
    expect(((await callWorkspaceRemoteTool(mcp, 'search_notes', { query: 'shared' }, false)).matches as { notebookId: string; }[]).map(match => match.notebookId)).toEqual(['kb~life']);
    expect(requested.filter(name => name === 'owner/vault')).toEqual([]);
    expect(requested).toContain('owner/kb');
  });
});
