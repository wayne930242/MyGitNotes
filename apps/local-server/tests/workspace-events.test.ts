import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { watchedWorktreeCount, watchWorktrees } from '../src/worktree-watch.js';

let root: string, server: Server | undefined, base: string;
/** Subscriptions a test opened, closed afterwards even when an assertion fails first. */
const stops: (() => void)[] = [];
const watch = (onChange: (ids: string[]) => void) => {
  const stop = watchWorktrees([{ id: 'home', root }], onChange);
  stops.push(stop);
  return stop;
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
/** Gives the platform watcher time to arm before the test writes, and to deliver afterwards. */
const settle = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-events-')));
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  write('notes/a/one.md', '# One\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
});
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it('reports a burst of worktree changes once, and ignores Git internals', async () => {
  const onChange = vi.fn();
  watch(onChange);
  await settle();
  write('notes/a/two.md', '# Two\n');
  write('notes/a/three.md', '# Three\n');
  await settle(600);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(['home']);

  onChange.mockClear();
  git('status');
  fs.writeFileSync(path.join(root, '.git', 'scratch'), 'x');
  await settle(600);
  expect(onChange).not.toHaveBeenCalled();
});

it('shares one watcher per worktree and closes it with the last subscriber', async () => {
  const stopFirst = watch(() => {});
  const stopSecond = watch(() => {});
  expect(watchedWorktreeCount()).toBe(1);
  stopFirst();
  expect(watchedWorktreeCount()).toBe(1);
  stopSecond();
  expect(watchedWorktreeCount()).toBe(0);
});

it('streams a change event when a file is added outside the app', async () => {
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;

  const controller = new AbortController();
  const res = await fetch(base + '/api/workspace/events', { signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  const until = async (text: string) => {
    while (!received.includes(text)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`Stream ended before ${text}`);
      received += decoder.decode(value);
    }
  };
  await until('retry: 3000');
  await settle();
  write('notes/a/added.md', '# Added\n');
  await until('event: change');
  expect(received).toMatch(/data: \{"repositories":\["[^"]+"\]\}/);

  controller.abort();
  await settle();
  expect(watchedWorktreeCount()).toBe(0);
});
