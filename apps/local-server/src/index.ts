import type { AddressInfo } from 'node:net';
import { applicationRoot, createApp } from './app.js';
import { chosenRepositorySource } from './workspace-choice.js';
import { writeDevPorts } from './dev-ports.js';
import { createPiAgent } from './pi-agent.js';
import { prewarmLocalScans } from './request-workspace.js';
import { assertWorkspaceCompatible, defaultMember, loadEnvDefaults } from '@mygitnotes/core';

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
}
const configSource = chosenRepositorySource(repoRoot);
if (isLocal) {
  // Fail fast: a missing workspace or a schema this Core cannot serve stops the dev server.
  const settings = await configSource.settings({ headers: {} });
  const worktree = defaultMember(settings)?.localPath;
  if (worktree) assertWorkspaceCompatible(worktree);
}
// The agent panel bridges to a Pi process on this machine, so only a local workspace offers it.
const piAgent = configSource.mode === 'local' ? createPiAgent() : undefined;
const app = createApp(repoRoot, { configSource, piAgent });

function listen(port: number, attemptsLeft: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    if (piAgent) {
      server.on('upgrade', (req, socket, head) => {
        if (!piAgent.upgrade(req, socket, head)) socket.destroy();
      });
    }
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
const warmStart = performance.now();
prewarmLocalScans(configSource).then(
  () => console.log(`[local-server] notes parsed in ${Math.round(performance.now() - warmStart)} ms`),
  // Requests still scan on demand; only the head start is lost.
  (error: unknown) => console.warn(`[local-server] background note scan failed: ${error instanceof Error ? error.message : String(error)}`),
);
