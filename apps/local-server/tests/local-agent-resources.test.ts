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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-agent-resources-'));
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  write('.agents/skills/existing/SKILL.md', '---\nname: existing\ndescription: Here\n---\n# Existing\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const save = (bodyValue: Record<string, unknown>) => fetch(`${base}/api/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyValue) });

it('saves an existing skill entry normally', async () => {
  const res = await save({ path: '.agents/skills/existing/SKILL.md', content: '---\nname: existing\ndescription: Updated\n---\n# Existing\n' });
  expect(res.status).toBe(200);
  expect(fs.readFileSync(path.join(root, '.agents/skills/existing/SKILL.md'), 'utf-8')).toContain('Updated');
});

it('rejects a save to a skill path that no longer exists, without create', async () => {
  const res = await save({ path: '.agents/skills/gone/SKILL.md', content: '# Gone\n' });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: expect.stringContaining('moved or deleted') });
  expect(fs.existsSync(path.join(root, '.agents/skills/gone'))).toBe(false);
});

it('creates a brand-new skill when create is set', async () => {
  const content = "---\nname: fresh\ndescription: ''\n---\n\n# fresh\n";
  const res = await save({ path: '.agents/skills/fresh/SKILL.md', content, create: true });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ success: true, path: '.agents/skills/fresh/SKILL.md' });
  expect(fs.readFileSync(path.join(root, '.agents/skills/fresh/SKILL.md'), 'utf-8')).toBe(content);
});

it('rejects create when the slug already collides with an existing skill', async () => {
  const res = await save({ path: '.agents/skills/existing/SKILL.md', content: '# New\n', create: true });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: expect.stringContaining('existing') });
});
