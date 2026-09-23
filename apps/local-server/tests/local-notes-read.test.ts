import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';

let root: string, server: Server, base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-read-'));
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n  - id: b\n    title: B\n    root: notes/b\n');
  write('notes/a/one.md', '# One\n');
  write('notes/b/two.md', '# Two\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it('reads a note without a notebookId query, inferring it from the path', async () => {
  const res = await fetch(base + '/api/notes/read?path=notes/b/two.md');
  expect(res.status).toBe(200);
  const { note } = await res.json();
  expect(note.notebookId).toBe('b');
  expect(note.content).toBe('# Two\n');
});

it('returns 404 for a note that no longer exists on disk', async () => {
  const res = await fetch(base + '/api/notes/read?path=notes/a/missing.md');
  expect(res.status).toBe(404);
});

it('picks up an external edit to the file on the next read', async () => {
  fs.writeFileSync(path.join(root, 'notes/a/one.md'), '# One\nChanged externally.\n');
  const res = await fetch(base + '/api/notes/read?path=notes/a/one.md&notebookId=a');
  expect((await res.json()).note.content).toBe('# One\nChanged externally.\n');
});
