import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnvDefaults } from '@mygitnotes/core';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
// Read into a private object, not process.env: resolveApiPort() below trusts an explicit
// process.env.PORT as the live local-server port, which a merely-default .env value is not.
const fileEnv: NodeJS.ProcessEnv = {};
loadEnvDefaults(path.join(repoRoot, '.env'), fileEnv);
const webPort = process.env.MYGITNOTES_WEB_PORT || fileEnv.MYGITNOTES_WEB_PORT;
const devPortsFile = process.env.MYGITNOTES_DEV_PORTS_FILE || path.join(repoRoot, '.mygitnotes-dev-ports.json');

interface DevPorts {
  serverPort?: number;
  serverPid?: number;
  webPort?: number;
}

function toPort(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;
}

function toPid(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readDevPorts(): DevPorts {
  try {
    const parsed = JSON.parse(fs.readFileSync(devPortsFile, 'utf-8'));
    return { serverPort: toPort(parsed.serverPort), serverPid: toPid(parsed.serverPid), webPort: toPort(parsed.webPort) };
  } catch {
    return {};
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function writeDevPort(key: keyof DevPorts, port: number): void {
  const ports = readDevPorts();
  ports[key] = port;
  try {
    fs.writeFileSync(devPortsFile, JSON.stringify(ports));
  } catch {
    // Best-effort dev convenience; the local-server falls back to its default origin allowlist.
  }
}

/**
 * local-server binds first and may move off 4321; wait briefly for it to publish its actual port.
 * A prior run may have left its own port in the file after exiting, so only trust a port whose
 * recorded pid is still alive; local-server writes the port and pid together, so a live pid means its port is live.
 */
async function resolveApiPort(): Promise<number> {
  if (process.env.PORT) return Number(process.env.PORT);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const { serverPort, serverPid } = readDevPorts();
    if (serverPort && serverPid && isProcessAlive(serverPid)) return serverPort;
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

  return { plugins: [react(), recordWebPort()], server: { port: toPort(Number(webPort)) ?? 5173, proxy: { '/api': { target: apiTarget, changeOrigin: true }, '/raw-assets': { target: apiTarget, changeOrigin: true }, '/r2-assets': { target: apiTarget, changeOrigin: true } } } };
});
