import express from 'express';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createPiAgent, type PiAgent, resolveAgentCwd } from './pi-agent.js';
import { commandAvailable, jsonlSplitter } from './pi-session.js';

// A stand-in for `pi --mode rpc`: answers get_state, echoes prompts with its cwd and argv, and asks one dialog.
const FAKE_PI = `
const out = record => process.stdout.write(JSON.stringify(record) + '\\n');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.type === 'get_state') out({ id: command.id, type: 'response', command: 'get_state', success: true, data: { isStreaming: false } });
    if (command.type === 'prompt' && command.message === 'ask') out({ type: 'extension_ui_request', id: 'dialog-1', method: 'select', title: 'Pick', options: ['A', 'B'] });
    else if (command.type === 'prompt') out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), message: command.message }) }] } });
    if (command.type === 'extension_ui_response') out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'answered ' + command.value }] } });
  }
});
process.stdin.on('end', () => process.exit(0));
`;

let server: Server | undefined;
let agent: PiAgent | undefined;
let temp: string | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await agent?.manager.end();
  agent = undefined;
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

async function start() {
  // Inside the home directory, which is the only place a session may run.
  temp = fs.mkdtempSync(path.join(os.homedir(), '.mygitnotes-pi-agent-test-'));
  const script = path.join(temp, 'fake-pi.cjs');
  fs.writeFileSync(script, FAKE_PI);
  const command = path.join(temp, 'fake-pi');
  fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const workspace = fs.realpathSync(temp);
  agent = createPiAgent({ command, defaultCwd: () => workspace });
  const app = express();
  app.use(express.json());
  app.use('/api/pi', agent.router);
  server = createServer(app);
  const piAgent = agent;
  server.on('upgrade', (req, socket, head) => {
    if (!piAgent.upgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server port');
  return { base: `http://127.0.0.1:${address.port}`, port: address.port, workspace };
}

const post = (base: string, method: string, body: unknown = {}, origin = base) => fetch(`${base}/api/pi/session`, { method, headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

/** Opens a socket and collects its records until `until` matches one. */
function connect(port: number, origin: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/pi/ws`, { origin });
  sockets.push(socket);
  const records: Record<string, unknown>[] = [];
  const waiters: { match: (record: Record<string, unknown>) => boolean; resolve: (record: Record<string, unknown>) => void; }[] = [];
  socket.on('message', data => {
    const record = JSON.parse(data.toString()) as Record<string, unknown>;
    records.push(record);
    for (const waiter of waiters.filter(candidate => candidate.match(record))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(record);
    }
  });
  const next = (match: (record: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>(resolve => {
      const seen = records.find(match);
      if (seen) resolve(seen);
      else waiters.push({ match, resolve });
    });
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    socket.once('error', reject);
  });
  return { socket, records, next, opened, send: (record: unknown) => socket.send(JSON.stringify(record)) };
}

const assistantText = (record: Record<string, unknown>) => (record.message as { content: { text: string; }[]; }).content[0].text;

describe('pi agent bridge', () => {
  it('starts Pi in the background and keeps it when the socket closes', async () => {
    const { base, port, workspace } = await start();
    const created = await (await post(base, 'POST')).json() as { session: { id: string; cwd: string; status: string; }; };
    expect(created.session.cwd).toBe(workspace);
    const again = await (await post(base, 'POST')).json() as { session: { id: string; }; };
    expect(again.session.id).toBe(created.session.id);

    const first = connect(port, base);
    await first.opened;
    await first.next(record => record.type === 'bridge_status' && (record.session as { status: string; }).status === 'ready');
    first.send({ type: 'prompt', message: 'hello' });
    const reply = JSON.parse(assistantText(await first.next(record => record.type === 'message_end'))) as { cwd: string; args: string[]; message: string; };
    expect(reply).toEqual({ cwd: workspace, args: ['--mode', 'rpc'], message: 'hello' });
    first.socket.close();

    const second = connect(port, `http://localhost:${port}`);
    await second.opened;
    const status = await second.next(record => record.type === 'bridge_status');
    expect(status.session as { id: string; status: string; }).toMatchObject({ id: created.session.id, status: 'ready' });
  });

  it('replays an unanswered dialog to a client that attaches later and resolves it for everyone', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const first = connect(port, base);
    await first.opened;
    first.send({ type: 'prompt', message: 'ask' });
    await first.next(record => record.type === 'extension_ui_request');

    const second = connect(port, base);
    await second.opened;
    const replayed = await second.next(record => record.type === 'extension_ui_request');
    expect(replayed).toMatchObject({ id: 'dialog-1', method: 'select', options: ['A', 'B'] });
    second.send({ type: 'extension_ui_response', id: 'dialog-1', value: 'B' });
    await first.next(record => record.type === 'bridge_ui_resolved' && record.id === 'dialog-1');
    expect(assistantText(await first.next(record => record.type === 'message_end'))).toBe('answered B');
  });

  it('refuses commands outside the panel surface', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    client.send({ type: 'bash', command: 'id' });
    expect(await client.next(record => record.type === 'bridge_error')).toMatchObject({ error: 'Command is not allowed.' });
  });

  it('refuses a socket or a session change from a non-loopback origin', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    await expect(connect(port, 'https://evil.example').opened).rejects.toThrow('HTTP 403');
    await expect(connect(port, 'https://notes.example.ts.net').opened).rejects.toThrow('HTTP 403');
    expect((await post(base, 'DELETE', {}, 'https://evil.example')).status).toBe(403);
    expect(agent?.manager.session?.alive).toBe(true);
  });

  it('restarts in another folder with a fresh session, and ends only when asked', async () => {
    const { base, port, workspace } = await start();
    const first = await (await post(base, 'POST')).json() as { session: { id: string; }; };
    const other = path.join(workspace, 'other');
    fs.mkdirSync(other);
    const client = connect(port, base);
    await client.opened;
    const switched = await (await post(base, 'PUT', { cwd: other, approve: true })).json() as { session: { id: string; cwd: string; approve: boolean; }; };
    expect(switched.session).toMatchObject({ cwd: other, approve: true });
    expect(switched.session.id).not.toBe(first.session.id);
    // The old session's clients learn it ended and are closed.
    await client.next(record => record.type === 'bridge_status' && (record.session as { status: string; }).status === 'exited');

    const next = connect(port, base);
    await next.opened;
    next.send({ type: 'prompt', message: 'where' });
    const reply = JSON.parse(assistantText(await next.next(record => record.type === 'message_end'))) as { cwd: string; args: string[]; };
    expect(reply).toMatchObject({ cwd: other, args: ['--mode', 'rpc', '--approve'] });

    expect(await (await post(base, 'DELETE')).json()).toEqual({ session: null });
    await expect(connect(port, base).opened).rejects.toThrow('HTTP 409');
  });

  it('keeps sessions inside the home directory', async () => {
    const { base } = await start();
    const response = await post(base, 'PUT', { cwd: '/' });
    expect(response.status).toBe(403);
    expect(() => resolveAgentCwd('relative/path')).toThrow('absolute');
    expect(() => resolveAgentCwd(path.join(os.homedir(), 'no-such-folder-mygitnotes'))).toThrow('does not exist');
  });
});

describe('Pi detection', () => {
  it('finds Pi by path or on PATH, and refuses to start a session without it', async () => {
    const { workspace } = await start();
    expect(commandAvailable(path.join(workspace, 'fake-pi'))).toBe(true);
    expect(commandAvailable(path.join(workspace, 'fake-pi.cjs'))).toBe(false);
    expect(commandAvailable('fake-pi', { PATH: `/no/such/dir${path.delimiter}${workspace}` })).toBe(true);
    expect(commandAvailable('fake-pi', { PATH: '/no/such/dir' })).toBe(false);

    const missing = createPiAgent({ command: path.join(workspace, 'no-pi-here'), defaultCwd: () => workspace });
    expect(missing.manager.available).toBe(false);
    expect(() => missing.manager.ensure(workspace, false)).toThrow('Pi is not installed on this computer.');
    expect(missing.manager.session).toBeUndefined();
  });
});

describe('jsonlSplitter', () => {
  it('splits on LF only, keeping U+2028 inside a record', () => {
    const lines: string[] = [];
    const feed = jsonlSplitter(line => lines.push(line));
    feed(Buffer.from('{"a":"x\u2028y"}\r\n{"b":'));
    feed(Buffer.from('1}\n'));
    expect(lines).toEqual(['{"a":"x\u2028y"}', '{"b":1}']);
  });
});
