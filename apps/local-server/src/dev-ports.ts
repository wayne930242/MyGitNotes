import fs from 'node:fs';
import path from 'node:path';

const DEV_PORTS_FILENAME = '.mygitnotes-dev-ports.json';

export interface DevPorts {
  serverPort?: number;
  serverPid?: number;
  webPort?: number;
}

function devPortsFile(repoRoot: string): string {
  return process.env.MYGITNOTES_DEV_PORTS_FILE || path.join(repoRoot, DEV_PORTS_FILENAME);
}

function toPort(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;
}

function toPid(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Reads the ports the local dev processes last bound to, so a sibling process can find a moved port. */
export function readDevPorts(repoRoot: string): DevPorts {
  try {
    const parsed = JSON.parse(fs.readFileSync(devPortsFile(repoRoot), 'utf-8'));
    return { serverPort: toPort(parsed.serverPort), serverPid: toPid(parsed.serverPid), webPort: toPort(parsed.webPort) };
  } catch {
    return {};
  }
}

export function writeDevPort(repoRoot: string, key: keyof DevPorts, port: number): void {
  const ports = readDevPorts(repoRoot);
  ports[key] = port;
  try {
    fs.writeFileSync(devPortsFile(repoRoot), JSON.stringify(ports));
  } catch {
    // Best-effort dev convenience; a sibling process falls back to its default port guess.
  }
}
