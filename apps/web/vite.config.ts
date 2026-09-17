import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const devPortsFile = process.env.MYGITNOTES_DEV_PORTS_FILE || path.join(repoRoot, '.mygitnotes-dev-ports.json');

interface DevPorts {
  serverPort?: number;
  webPort?: number;
}

function readDevPorts(): DevPorts {
  try { return JSON.parse(fs.readFileSync(devPortsFile, 'utf-8')); } catch { return {}; }
}

function writeDevPort(key: keyof DevPorts, port: number): void {
  const ports = readDevPorts();
  ports[key] = port;
  try { fs.writeFileSync(devPortsFile, JSON.stringify(ports)); } catch {
    // Best-effort dev convenience; the local-server falls back to its default origin allowlist.
  }
}

/** local-server binds first and may move off 4321; wait briefly for it to publish its actual port. */
async function resolveApiPort(): Promise<number> {
  if (process.env.PORT) return Number(process.env.PORT);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const port = readDevPorts().serverPort;
    if (port) return port;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return 4321;
}

function recordWebPort(): Plugin {
  return {
    name: 'mygitnotes-record-web-port',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer!.address();
        if (address && typeof address === 'object') writeDevPort('webPort', address.port);
      });
    },
  };
}

export default defineConfig(async ({ command }) => {
  const apiTarget = `http://127.0.0.1:${command === 'serve' ? await resolveApiPort() : 4321}`;

  return {
    plugins: [react(), recordWebPort()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/raw-assets': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/r2-assets': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
