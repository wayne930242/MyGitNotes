import type { AddressInfo } from 'node:net';
import { createApp, applicationRoot } from './app.js';
import { writeDevPorts } from './dev-ports.js';
import { assertWorkspaceCompatible, loadEnvDefaults, loadSourceConfig } from '@mygitnotes/core';

loadEnvDefaults(`${applicationRoot()}/.env`);
const desiredPort = Number(process.env.PORT || 4321);
const host = process.env.HOST || '127.0.0.1';
const MAX_PORT_ATTEMPTS = 20;
const repoRoot = applicationRoot();
const isLocal = process.argv.includes('--local');
if (isLocal) {
  process.env.MYGITNOTES_SOURCE = 'local';
  const localPath = process.env.REPO_ROOT || process.env.MYGITNOTES_LOCAL_PATH || process.env.GITHUB_NOTES_LOCAL_PATH;
  if (localPath) process.env.MYGITNOTES_LOCAL_PATH = localPath;
  // Fail fast: a missing workspace or a schema this Core cannot serve stops the dev server.
  const source = loadSourceConfig(repoRoot);
  if (source.type === 'local') assertWorkspaceCompatible(source.path);
}
const app = createApp(repoRoot);

function listen(port: number, attemptsLeft: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server.address() as AddressInfo));
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) resolve(listen(port + 1, attemptsLeft - 1));
      else reject(error);
    });
  });
}

const { port } = await listen(desiredPort, MAX_PORT_ATTEMPTS);
if (isLocal) {
  process.env.APP_URL = `http://localhost:${port}`;
  // One write, so a reader never pairs this port with a previous run's pid.
  writeDevPorts(repoRoot, { serverPort: port, serverPid: process.pid });
}
console.log(`[local-server] http://${host}:${port}`);
