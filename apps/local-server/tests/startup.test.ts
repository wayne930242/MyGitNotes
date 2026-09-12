import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

let child: ChildProcess | undefined;
let root: string | undefined;
afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child!.once('exit', resolve));
    child.kill();
    await exited;
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it('local development opens the selected local checkout anonymously despite deployment source settings', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-startup-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  child = spawn(process.execPath, ['--import', 'tsx', 'apps/local-server/src/index.ts', '--local'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PORT: String(port),
      REPO_ROOT: root,
      GITHUB_NOTES_LOCAL_PATH: root,
      GITHUB_NOTES_SOURCE: 'github',
      GITHUB_NOTES_REPOSITORY: 'invalid-deployment-repository',
      GITHUB_NOTES_BRANCH: 'main',
      APP_URL: 'https://deployment.example',
      VERCEL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    child!.stdout!.on('data', data => { if (String(data).includes('[local-server]')) resolve(); });
    child!.once('error', reject);
    child!.once('exit', code => reject(new Error(`Server exited: ${code}`)));
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/workspace`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    repoRoot: root,
    branch: 'main',
    source: { type: 'local' },
    capabilities: { write: true, local: true },
  });
  expect((await fetch(`http://127.0.0.1:${port}/api/workspace`, {
    headers: { Origin: 'https://deployment.example' },
  })).status).toBe(403);
}, 15000);
