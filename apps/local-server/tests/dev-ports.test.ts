import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDevPorts, writeDevPort } from '../src/dev-ports.js';

let root: string | undefined;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it('ignores non-numeric or out-of-range port values from a corrupted or malicious discovery file', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-'));
  fs.writeFileSync(path.join(root, '.mygitnotes-dev-ports.json'), JSON.stringify({
    serverPort: '4321@evil.com',
    webPort: '1|.*',
  }));
  expect(readDevPorts(root)).toEqual({ serverPort: undefined, webPort: undefined });
});

it('rejects a port outside the valid 1-65535 range', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-'));
  fs.writeFileSync(path.join(root, '.mygitnotes-dev-ports.json'), JSON.stringify({ serverPort: 0, webPort: 70000 }));
  expect(readDevPorts(root)).toEqual({ serverPort: undefined, webPort: undefined });
});

it('still round-trips a valid port written by writeDevPort', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-'));
  writeDevPort(root, 'serverPort', 4321);
  expect(readDevPorts(root)).toEqual({ serverPort: 4321, webPort: undefined });
});

it('round-trips the serverPid written alongside the port', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-'));
  writeDevPort(root, 'serverPort', 4321);
  writeDevPort(root, 'serverPid', process.pid);
  expect(readDevPorts(root)).toEqual({ serverPort: 4321, serverPid: process.pid, webPort: undefined });
});
