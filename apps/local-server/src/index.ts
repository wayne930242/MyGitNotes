import type { AddressInfo } from 'node:net';
import { createApp, applicationRoot } from './app.js';
import { writeDevPort } from './dev-ports.js';

try { process.loadEnvFile(`${applicationRoot()}/.env`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const desiredPort = Number(process.env.PORT || 4321);
const host = process.env.HOST || '127.0.0.1';
const MAX_PORT_ATTEMPTS = 20;
const repoRoot = applicationRoot();
const isLocal = process.argv.includes('--local');
if (isLocal) {
  process.env.MYGITNOTES_SOURCE = 'local';
  process.env.MYGITNOTES_LOCAL_PATH = process.env.REPO_ROOT || process.env.MYGITNOTES_LOCAL_PATH || process.env.GITHUB_NOTES_LOCAL_PATH || repoRoot;
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
  writeDevPort(repoRoot, 'serverPort', port);
}
console.log(`[local-server] http://${host}:${port}`);
