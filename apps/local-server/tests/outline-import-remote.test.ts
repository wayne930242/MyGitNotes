import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { BOOKMARKS_FILE, repositoryRef, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { githubFixture } from '../../../packages/core/tests/fixtures/github.js';
import { gitlabFixture } from '../../../packages/core/tests/fixtures/gitlab.js';

vi.mock('../src/auth.js', async original => ({ ...await original<typeof import('../src/auth.js')>(), authToken: async () => 'fixture-token' }));
vi.setConfig({ testTimeout: 30000 });
const raw = '# preserve exact source\r\nversion: 1\r\nnotebooks:\r\n  - notebookId: ex\r\n    groups: []\r\n    bookmarks:\r\n      - id: note\r\n        label: Alpha\r\n        groupId: null\r\n        target: { kind: note, path: a.md }\r\n      - id: folder\r\n        label: Folder\r\n        groupId: null\r\n        target: { kind: folder, path: work }\r\n';
let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
for (const provider of ['github', 'gitlab'] as const) {
  describe(provider + ' actual provider HTTP import', () => {
    async function setup() {
      const github = githubFixture({ [BOOKMARKS_FILE]: raw });
      const gitlab = gitlabFixture(undefined, { [BOOKMARKS_FILE]: raw });
      const fixture = provider === 'github' ? github : gitlab;
      const home = repositoryRef(provider === 'github' ? { type: 'github', repository: 'owner/repo', branch: 'main' } : { type: 'gitlab', repository: 'group/subgroup/project', branch: 'main', url: 'https://gitlab.example.test/gitlab' });
      const configSource: WorkspaceConfigSource = { mode: 'remote', settings: async () => ({ home, localPath: () => undefined, manifest: inHome => inHome() }) };
      let readOnly = false, failWrite = false;
      const network = globalThis.fetch;
      vi.stubGlobal(
        'fetch',
        (async (input, init) => {
          const url = String(input);
          if (url.startsWith('http://127.0.0.1:')) return network(input, init);
          if (failWrite && init?.method && init.method !== 'GET') return new Response('{"message":"Injected provider failure"}', { status: 403 });
          const response = await fixture.request(input, init);
          if (readOnly && provider === 'github' && url === 'https://api.github.com/repos/owner/repo') return new Response(JSON.stringify({ private: true, permissions: { push: false } }));
          return response;
        }) as typeof fetch,
      );
      vi.stubEnv('APP_URL', '');
      vi.stubEnv('VERCEL', '');
      server = createServer(createApp(process.cwd(), { configSource }));
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as { port: number; }).port}/api/outline-import`;
      const input = { repository: home.id, notebookId: 'ex', selectedIds: ['note', 'folder'], path: 'notes/ex/imported.outline.md', title: 'Imported' };
      const post = (suffix: string, data: unknown) => fetch(base + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const preview = async () => {
        const response = await post('/preview', input);
        expect(response.status).toBe(200);
        return response.json();
      };
      const apply = (token: string, extras = {}) => post('', { ...input, token, acknowledgePartial: true, ...extras });
      return {
        github,
        gitlab,
        input,
        post,
        preview,
        apply,
        text: (file: string) => provider === 'github' ? github.text(file) : gitlab.files.get(file),
        head: () => provider === 'github' ? github.head() : gitlab.head,
        commits: () => provider === 'github' ? github.calls.filter(call => call.endpoint === '/git/commits').length : gitlab.writes,
        readOnly: () => {
          readOnly = true;
          gitlab.readOnly();
        },
        failWrite: () => {
          failWrite = true;
        },
      };
    }
    it('previews at a paired snapshot, commits only one new outline, retains bytes and rejects duplicate/stale/partial-unacknowledged requests', async () => {
      const f = await setup(), head = f.head();
      const record = await f.preview();
      expect(record).toMatchObject({ revision: head, persistence: 'commit', writable: true, partial: true });
      expect(f.commits()).toBe(0);
      expect(f.text(f.input.path)).toBeUndefined();
      expect((await f.apply(record.token, { acknowledgePartial: false })).status).toBe(400);
      expect((await f.apply(record.token)).status).toBe(200);
      expect(f.commits()).toBe(1);
      expect(f.text(BOOKMARKS_FILE)).toBe(raw);
      expect(f.text(f.input.path)).toBe(record.markdown);
      expect((await f.apply(record.token)).status).toBe(409);
      expect(f.commits()).toBe(1);
      if (provider === 'github') expect(f.github.calls.find(call => call.endpoint === '/git/trees' && call.method)?.body.tree.map((entry: { path: string; }) => entry.path)).toEqual([f.input.path]);
      else {
        const commit = f.gitlab.calls.find(call => call.url.endsWith('/repository/commits') && call.init?.method === 'POST');
        const body = JSON.parse(String(commit!.init!.body));
        expect(body.actions).toHaveLength(1);
        expect(body.actions[0]).toMatchObject({ action: 'create', file_path: f.input.path });
      }
    });
    it('read-only preview is available but apply and provider failures preserve the original tree', async () => {
      const f = await setup();
      f.readOnly();
      const record = await f.preview();
      expect(record.writable).toBe(false);
      expect((await f.apply(record.token)).status).toBe(403);
      expect(f.commits()).toBe(0);
      expect(f.text(BOOKMARKS_FILE)).toBe(raw);
      expect(f.text(f.input.path)).toBeUndefined();
    });
    it('provider failure cannot publish a partial import or change legacy bytes', async () => {
      const f = await setup(), head = f.head(), record = await f.preview();
      f.failWrite();
      expect((await f.apply(record.token)).status).toBeGreaterThanOrEqual(400);
      expect(f.head()).toBe(head);
      expect(f.text(BOOKMARKS_FILE)).toBe(raw);
      expect(f.text(f.input.path)).toBeUndefined();
    });
    it('rejects changed source/head and changed request identities rather than trusting proposed Markdown', async () => {
      const f = await setup(), record = await f.preview();
      expect((await f.apply(record.token, { content: 'client supplied replacement' })).status).toBe(400);
      expect((await f.apply(record.token, { title: 'Changed after preview' })).status).toBe(409);
      if (provider === 'github') await f.github.reader().commitChanges([{ path: 'notes/ex/a.md', content: '# Concurrent edit\n' }], f.head(), 'save');
      else {
        f.gitlab.files.set(BOOKMARKS_FILE, raw + '# concurrent edit\r\n');
        f.gitlab.setHead('f'.repeat(40));
      }
      const head = f.head(), commits = f.commits();
      expect((await f.apply(record.token)).status).toBe(409);
      expect(f.head()).toBe(head);
      expect(f.commits()).toBe(commits);
      expect(f.text(f.input.path)).toBeUndefined();
    });
  });
}
