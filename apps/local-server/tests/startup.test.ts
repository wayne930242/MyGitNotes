import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { get } from 'node:http';

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

it.each(['127.0.0.1', '0.0.0.0'])('local development supports HOST=%s and opens the selected checkout despite deployment settings', async host => {
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
      HOST: host,
      REPO_ROOT: root,
      GITHUB_NOTES_LOCAL_PATH: root,
      GITHUB_NOTES_SOURCE: 'github',
      GITHUB_NOTES_REPOSITORY: 'invalid-deployment-repository',
      GITHUB_NOTES_BRANCH: 'main',
      APP_URL: 'https://deployment.example',
      VERCEL: '',
      MYGITNOTES_DEV_PORTS_FILE: path.join(root, '.mygitnotes-dev-ports.json'),
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
  const externalHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(`http://127.0.0.1:${port}/api/workspace`, { headers: { Host: 'public.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  expect(externalHostStatus).toBe(403);
}, 15000);

it('binds the next free port when the desired one is occupied and records it for the web dev server', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-startup-'));
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
  const occupied = createServer();
  await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const desiredPort = (occupied.address() as { port: number }).port;
  const devPortsFile = path.join(root, '.mygitnotes-dev-ports.json');
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/local-server/src/index.ts', '--local'], {
      cwd: path.resolve('.'),
      env: { ...process.env, PORT: String(desiredPort), HOST: '127.0.0.1', REPO_ROOT: root, GITHUB_NOTES_LOCAL_PATH: root, GITHUB_NOTES_SOURCE: 'local', APP_URL: '', VERCEL: '', MYGITNOTES_DEV_PORTS_FILE: devPortsFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const boundPort = await new Promise<number>((resolve, reject) => {
      child!.stdout!.on('data', data => {
        const match = String(data).match(/\[local-server\] http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) resolve(Number(match[1]));
      });
      child!.once('error', reject);
      child!.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    });
    expect(boundPort).toBeGreaterThan(desiredPort);
    expect((await fetch(`http://127.0.0.1:${boundPort}/api/workspace`)).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(devPortsFile, 'utf8'))).toMatchObject({ serverPort: boundPort });
  } finally {
    await new Promise<void>(resolve => occupied.close(() => resolve()));
  }
}, 15000);
