import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps/web');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitUntilReady(base, deadline) {
  while (Date.now() < deadline) {
    try {
      await fetch(base);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`vite dev server did not become ready at ${base}`);
}

/** Boots a disposable `vite dev` server for apps/web on an OS-assigned loopback port, so
 *  scripts that need real vite dev-mode module serving (HMR client, unbundled source) run
 *  self-contained instead of depending on an already-running `pnpm dev` at a fixed port. */
export async function startViteDevServer() {
  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(path.join(webDir, 'node_modules/.bin/vite'), ['--port', String(port), '--host', '127.0.0.1', '--strictPort'], {
    cwd: webDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('exit', code => reject(new Error(`vite dev exited early (code ${code}): ${stderr}`)));
    child.once('error', reject);
  });
  exited.catch(() => {});
  await Promise.race([waitUntilReady(base, Date.now() + 20000), exited]);
  return {
    base,
    async close() {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    },
  };
}
