import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { repositoryRef, type WorkspaceConfigSource, type WorkspaceRequest } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

/** A local worktree holding one manifest and one note, committed on main. */
function worktree(title: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-config-source-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  fs.mkdirSync(path.join(root, 'notes/ex'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes/.mygitnotes.yaml'), `schema_version: 1\nworkspace:\n  title: ${title}\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n`);
  fs.writeFileSync(path.join(root, 'notes/ex/note.md'), `# ${title} note\n`);
  git('add', '.');
  git('commit', '-m', 'fixture');
  return root;
}

/** Stands in for a database-backed source: the workspace is chosen by a request header. */
function tenantConfigSource(roots: Record<string, string>): WorkspaceConfigSource {
  return {
    mode: 'local',
    async settings(request: WorkspaceRequest) {
      const tenant = request.headers['x-tenant'];
      const root = typeof tenant === 'string' ? roots[tenant] : undefined;
      if (!root) throw new Error('Unknown tenant.');
      return { home: repositoryRef({ type: 'local', path: root }), localPath: () => undefined, manifest: inHomeRepository => inHomeRepository() };
    },
  };
}

let roots: string[] = [];
let server: Server;
let base: string;
beforeEach(() => {
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('VERCEL', '');
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots = [];
  vi.unstubAllEnvs();
});

describe('a replaceable configuration source', () => {
  it('serves a different workspace to each request on one app instance', async () => {
    const alpha = worktree('Alpha'), beta = worktree('Beta');
    roots = [alpha, beta];
    server = createServer(createApp(alpha, { configSource: tenantConfigSource({ alpha, beta }) }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
    const workspace = (tenant: string) => fetch(`${base}/api/workspace`, { headers: { 'x-tenant': tenant } }).then(response => response.json());
    const note = (tenant: string) => fetch(`${base}/api/notes/read?path=notes/ex/note.md`, { headers: { 'x-tenant': tenant } }).then(response => response.json());
    expect((await workspace('alpha')).config.workspace.title).toBe('Alpha');
    expect((await workspace('beta')).config.workspace.title).toBe('Beta');
    expect((await note('alpha')).note.content).toContain('Alpha note');
    expect((await note('beta')).note.content).toContain('Beta note');
    const { repositories: [betaHome] } = await workspace('beta');
    const saved = await fetch(`${base}/api/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-tenant': 'beta' }, body: JSON.stringify({ repository: betaHome.id, configRevision: betaHome.configRevision, configYaml: 'schema_version: 1\nworkspace:\n  title: Beta renamed\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n' }) });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(beta, 'notes/.mygitnotes.yaml'), 'utf8')).toContain('Beta renamed');
    expect(fs.readFileSync(path.join(alpha, 'notes/.mygitnotes.yaml'), 'utf8')).toContain('title: Alpha');
  });
});
