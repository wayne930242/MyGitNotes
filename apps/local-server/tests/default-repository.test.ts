import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { workspaceSettings } from './workspace-settings.js';

let root: string, server: Server | undefined, base: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-default-repository-'));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), APP_URL: '', VERCEL: '', UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_PRODUCT_REPOSITORY: '' })) vi.stubEnv(key, value);
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function listen(configSource: WorkspaceConfigSource) {
  server = createServer(createApp(root, { configSource, remoteCache: undefined }));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
}

it('opens a local source that is a folder inside a Git worktree, as the examples workspace is', async () => {
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  const workspace = path.join(root, 'examples/workspace');
  fs.mkdirSync(path.join(workspace, 'notes/ex'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.mygitnotes.yaml'), 'schema_version: 4\nworkspace:\n  title: Example\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Ex\n    root: notes/ex\n');
  fs.writeFileSync(path.join(workspace, 'notes/ex/a.md'), '# Inside\n');
  await listen({ mode: 'local', settings: async () => workspaceSettings([{ type: 'local', path: workspace }]) });
  const answer = await fetch(`${base}/api/workspace`).then(response => response.json());
  expect(answer.repositories).toHaveLength(1);
  expect(answer.repositories[0]).not.toHaveProperty('unavailable');
  expect(answer.repositories[0].notebooks).toEqual(['workspace~ex']);
  expect((await fetch(`${base}/api/notes/read?path=notes/ex/a.md&notebookId=workspace~ex`).then(response => response.json())).note.content).toContain('Inside');
});

it('asks a signed-out visitor to sign in when the private default repository refuses them, instead of opening an empty workspace', async () => {
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => String(url).startsWith('https://api.github.com/') ? new Response('{"message":"Not Found"}', { status: 404 }) : nativeFetch(url, init));
  await listen({ mode: 'remote', settings: async () => workspaceSettings([{ type: 'github', repository: 'owner/private', branch: 'main' }]) });
  const answer = await fetch(`${base}/api/workspace`);
  expect(answer.status).toBe(404);
  expect((await fetch(`${base}/api/notes`)).status).toBe(404);
});
