import { SourceError } from '@mygitnotes/core';
import express from 'express';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { endEventStreams, membershipGeneration } from './event-stream.js';
import { agentClientAllowed, type AgentFolder, createPiAgent, resolveAgentCwd, resumableSession } from './pi-agent.js';
import { commandAvailable, jsonlSplitter, MCP_STATUS_KEY, type PiMcpServer, TRUST_EXTENSION, TRUST_STATUS_KEY, WEB_CHAT_PROMPT, WEB_TOOLS_EXTENSION, WEB_TOOLS_PROMPT } from './pi-session.js';

// A stand-in for `pi --mode rpc`: answers get_state with its session file (the --session one, else a new one per conversation),
// echoes prompts with its cwd and argv, asks one dialog, and sets or clears a status.
const FAKE_PI = `
const out = record => process.stdout.write(JSON.stringify(record) + '\\n');
let buffer = '';
const resumed = process.argv.indexOf('--session');
let conversation = 0;
const queued = [];
let sessionFile = resumed >= 0 ? process.argv[resumed + 1] : process.cwd() + '/session-0.jsonl';
out({ type: 'extension_ui_request', id: 'trust', method: 'setStatus', statusKey: 'mygitnotes-project-trust', statusText: 'untrusted' });
out({ type: 'extension_ui_request', id: 'mcp', method: 'setStatus', statusKey: 'mygitnotes-mcp-servers', statusText: JSON.stringify([{ name: 'linear', status: 'connected', toolCount: 12 }, { name: 'figma', status: 'disabled', toolCount: 0 }, { name: 'local', status: 'blocked', toolCount: 0, blockedReason: 'untrusted' }, { status: 'connected' }]) });
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.type === 'bash') out({ id: command.id, type: 'response', command: 'bash', success: true, data: { output: 'ran ' + command.command, exitCode: 0, cancelled: false, truncated: false } });
    if (command.type === 'set_model') out({ id: command.id, type: 'response', command: 'set_model', success: true, data: { provider: command.provider, id: command.modelId } });
    if (command.type === 'get_state') out({ id: command.id, type: 'response', command: 'get_state', success: true, data: { isStreaming: false, sessionFile } });
    if (command.type === 'new_session') {
      sessionFile = process.cwd() + '/session-' + ++conversation + '.jsonl';
      out({ id: command.id, type: 'response', command: 'new_session', success: true, data: { cancelled: false } });
    }
    if (command.type === 'prompt' && command.streamingBehavior === 'steer') {
      queued.push(command.message);
      out({ type: 'queue_update', steering: queued, followUp: [] });
      continue;
    }
    if (command.type === 'clear_queue') {
      out({ id: command.id, type: 'response', command: 'clear_queue', success: true, data: { steering: queued.splice(0), followUp: [] } });
      out({ type: 'queue_update', steering: [], followUp: [] });
    }
    if (command.type === 'prompt' && command.message === 'status') {
      out({ type: 'extension_ui_request', id: 's1', method: 'setStatus', statusKey: 'quota', statusText: '42%' });
      out({ type: 'extension_ui_request', id: 's2', method: 'setStatus', statusKey: 'gone', statusText: 'soon cleared' });
      out({ type: 'extension_ui_request', id: 's3', method: 'setStatus', statusKey: 'gone' });
      out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'status set' }] } });
    } else if (command.type === 'prompt' && command.message.startsWith('tool ')) {
      // What the web tools extension does: call the bridge with the session's token, and report the answer.
      fetch(process.env.MYGITNOTES_WEB_TOOLS_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (command.message === 'tool forged' ? 'x' : process.env.MYGITNOTES_WEB_TOOLS_TOKEN) }, body: JSON.stringify({ tool: 'read_note', arguments: { path: 'notes/a.md' } }) })
        .then(async res => out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ message: command.message, status: res.status, body: await res.json() }) }] } }));
    } else if (command.type === 'prompt' && command.message === 'ask') out({ type: 'extension_ui_request', id: 'dialog-1', method: 'select', title: 'Pick', options: ['A', 'B'] });
    else if (command.type === 'prompt') out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), message: command.message }) }] } });
    if (command.type === 'extension_ui_response') out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'answered ' + command.value }] } });
  }
});
process.stdin.on('end', () => process.exit(0));
`;

let server: Server | undefined;
let agent: ReturnType<typeof createPiAgent> | undefined;
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

function testFolder(workspace: string, resolving?: () => void) {
  return async (_res: unknown, repository: unknown, folder: unknown): Promise<AgentFolder> => {
    resolving?.();
    if (repository !== 'home') throw new SourceError('Unknown repository.', 404);
    return { cwd: resolveAgentCwd(folder ? path.join(workspace, String(folder)) : workspace), location: { repository, folder: String(folder ?? '') } };
  };
}

/** `resolving` runs while each request resolves its folder, as a membership change made meanwhile would. */
async function start({ webTools = false, resolving }: { webTools?: boolean; resolving?: () => void; } = {}) {
  // Inside the home directory, which is the only place a session may run.
  temp = fs.mkdtempSync(path.join(os.homedir(), '.mygitnotes-pi-agent-test-'));
  const script = path.join(temp, 'fake-pi.cjs');
  fs.writeFileSync(script, FAKE_PI);
  const command = path.join(temp, 'fake-pi');
  fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const workspace = fs.realpathSync(temp);
  // Repository `home` lives at the temp root; any folder name maps to the directory of that name inside it.
  agent = createPiAgent({ command, resolveFolder: testFolder(workspace, resolving), webTools });
  const app = express();
  app.use(express.json());
  // As requestWorkspace does before it reads the members.
  app.use((_req, res, next) => {
    res.locals.membershipGeneration = membershipGeneration();
    next();
  });
  // As createApp does: Pi's own calls are answered ahead of the workspace a signed-in request opens.
  if (agent.tools) app.use('/api/pi', agent.tools);
  app.use('/api/pi', agent.router);
  server = createServer(app);
  const piAgent = agent;
  server.on('upgrade', (req, socket, head) => {
    if (!piAgent.upgrade?.(req, socket, head)) socket.destroy();
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server port');
  return { base: `http://127.0.0.1:${address.port}`, port: address.port, workspace };
}

const post = (base: string, method: string, body: unknown = { repository: 'home', folder: '' }, origin = base) => fetch(`${base}/api/pi/session`, { method, headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

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
    expect(reply).toEqual({ cwd: workspace, args: ['--mode', 'rpc', '--extension', TRUST_EXTENSION, '--append-system-prompt', WEB_CHAT_PROMPT], message: 'hello' });
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

  it("reads Pi's project-trust report into the session instead of passing it on as a status line", async () => {
    // The extension Pi loads reports under the key the bridge reads.
    expect(fs.readFileSync(TRUST_EXTENSION, 'utf8')).toContain(`TRUST_STATUS_KEY = '${TRUST_STATUS_KEY}'`);
    const { base, port } = await start();
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    await client.next(record => record.type === 'bridge_status' && (record.session as { trusted?: boolean; }).trusted === false);
    expect((await (await fetch(`${base}/api/pi/session`)).json() as { session: { trusted?: boolean; }; }).session.trusted).toBe(false);
    expect(client.records.some(record => record.statusKey === TRUST_STATUS_KEY)).toBe(false);
  });

  it('reads the MCP servers the extension relays from pi-mcp-adapter into the session, dropping malformed entries', async () => {
    expect(fs.readFileSync(TRUST_EXTENSION, 'utf8')).toContain(`MCP_STATUS_KEY = '${MCP_STATUS_KEY}'`);
    const { base, port } = await start();
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    await client.next(record => record.type === 'bridge_status' && Array.isArray((record.session as { mcpServers?: unknown; }).mcpServers));
    const { session } = await (await fetch(`${base}/api/pi/session`)).json() as { session: { mcpServers?: PiMcpServer[]; }; };
    expect(session.mcpServers).toEqual([{ name: 'linear', status: 'connected', toolCount: 12 }, { name: 'figma', status: 'disabled', toolCount: 0 }, { name: 'local', status: 'blocked', toolCount: 0, blockedReason: 'untrusted' }]);
    expect(client.records.some(record => record.statusKey === MCP_STATUS_KEY)).toBe(false);
  });

  it('replays the latest status lines to a client that attaches later, but not cleared ones', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const first = connect(port, base);
    await first.opened;
    first.send({ type: 'prompt', message: 'status' });
    await first.next(record => record.type === 'message_end');

    const second = connect(port, base);
    await second.opened;
    await second.next(record => record.type === 'bridge_status');
    second.send({ type: 'get_state' });
    await second.next(record => record.type === 'response');
    expect(second.records.filter(record => record.method === 'setStatus')).toEqual([expect.objectContaining({ statusKey: 'quota', statusText: '42%' })]);
  });

  it('tells Pi it runs in the web chat, where dialogs, slash commands and !commands work', () => {
    expect(WEB_CHAT_PROMPT).toContain('ask_user');
    expect(WEB_CHAT_PROMPT).toContain('/skill:name');
    expect(WEB_CHAT_PROMPT).toContain('/reload');
    expect(WEB_CHAT_PROMPT).toContain('`!command`');
    expect(WEB_CHAT_PROMPT).toContain('robot_hand');
    expect(WEB_CHAT_PROMPT).toContain('interjection');
  });

  it('replays the waiting message queue to a client that attaches later, and stops once it empties', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const first = connect(port, base);
    await first.opened;
    first.send({ type: 'prompt', message: 'later', streamingBehavior: 'steer' });
    await first.next(record => record.type === 'queue_update');

    const second = connect(port, base);
    await second.opened;
    expect(await second.next(record => record.type === 'queue_update')).toMatchObject({ steering: ['later'], followUp: [] });

    first.send({ id: 'clear', type: 'clear_queue' });
    await first.next(record => record.type === 'queue_update' && (record.steering as string[]).length === 0);
    const third = connect(port, base);
    await third.opened;
    await third.next(record => record.type === 'bridge_status');
    third.send({ type: 'get_state' });
    await third.next(record => record.type === 'response');
    expect(third.records.some(record => record.type === 'queue_update')).toBe(false);
  });

  it('forwards model and thinking switches, and answers every attached client', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const first = connect(port, base), second = connect(port, base);
    await Promise.all([first.opened, second.opened]);
    first.send({ id: 'switch', type: 'set_model', provider: 'openai-codex', modelId: 'gpt-6.1-sol' });
    expect(await second.next(record => record.type === 'response' && record.command === 'set_model')).toMatchObject({ success: true, data: { provider: 'openai-codex', id: 'gpt-6.1-sol' } });
  });

  it('refuses commands outside the panel surface', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    client.send({ type: 'switch_session', sessionPath: '/etc/passwd' });
    expect(await client.next(record => record.type === 'bridge_error')).toMatchObject({ error: 'Command is not allowed.' });
  });

  it('forwards the shell commands the panel runs with !', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    client.send({ id: 'shell', type: 'bash', command: 'id' });
    expect(await client.next(record => record.type === 'response' && record.command === 'bash')).toMatchObject({ id: 'shell', success: true, data: { output: 'ran id' } });
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
    const switched = await (await post(base, 'PUT', { repository: 'home', folder: 'other' })).json() as { session: { id: string; cwd: string; }; };
    expect(switched.session).toMatchObject({ cwd: other, location: { repository: 'home', folder: 'other' } });
    expect(switched.session.id).not.toBe(first.session.id);
    // The old session's clients learn it ended and are closed.
    await client.next(record => record.type === 'bridge_status' && (record.session as { status: string; }).status === 'exited');

    const next = connect(port, base);
    await next.opened;
    next.send({ type: 'prompt', message: 'where' });
    const reply = JSON.parse(assistantText(await next.next(record => record.type === 'message_end'))) as { cwd: string; args: string[]; };
    expect(reply).toMatchObject({ cwd: other, args: ['--mode', 'rpc', '--extension', TRUST_EXTENSION, '--append-system-prompt', WEB_CHAT_PROMPT] });

    const root = await (await post(base, 'PUT', { repository: 'home', folder: '' })).json() as { session: { cwd: string; location: unknown; }; };
    expect(root.session).toMatchObject({ cwd: workspace, location: { repository: 'home', folder: '' } });

    expect(await (await post(base, 'DELETE')).json()).toEqual({ session: null });
    await expect(connect(port, base).opened).rejects.toThrow('HTTP 409');
  });

  it('starts no session when the members changed while its folder was being resolved, and asks the page to retry', async () => {
    let change = true;
    const { base } = await start({ resolving: () => change && endEventStreams() });
    for (const method of ['POST', 'PUT']) {
      const refused = await post(base, method);
      expect([method, refused.status, (await refused.json() as { error: string; }).error]).toEqual([method, 409, expect.stringContaining('Start it again')]);
      expect(agent!.manager.session).toBeUndefined();
    }
    // The page's retry reads the members as they are now and starts.
    change = false;
    expect((await post(base, 'POST')).status).toBe(200);
    expect(agent!.manager.session?.alive).toBe(true);
  });

  it('ends a session whose repository was hidden, saying so, and keeps one whose repository stays', async () => {
    const { base, port } = await start();
    const created = await (await post(base, 'POST')).json() as { session: { id: string; }; };
    const client = connect(port, base);
    await client.opened;
    await client.next(record => record.type === 'bridge_status' && (record.session as { status: string; }).status === 'ready');
    await agent!.membershipChanged(['home', 'other']);
    expect(agent!.manager.session?.alive).toBe(true);
    await agent!.membershipChanged(['other']);
    const ended = await client.next(record => record.type === 'bridge_status' && (record.session as { status: string; }).status === 'exited');
    expect(ended.session).toMatchObject({ id: created.session.id, endedBecause: 'repository-hidden' });
    // A page that asks later learns the same, and starting again makes a new session.
    expect((await (await fetch(`${base}/api/pi/session`)).json() as { session: unknown; }).session).toMatchObject({ id: created.session.id, status: 'exited', endedBecause: 'repository-hidden' });
    const restarted = await (await post(base, 'POST')).json() as { session: { id: string; endedBecause?: string; }; };
    expect(restarted.session.id).not.toBe(created.session.id);
    expect(restarted.session.endedBecause).toBeUndefined();
  });

  it('records the session file Pi reports, and the one a new conversation moves to', async () => {
    const { base, port, workspace } = await start();
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    const sessionFile = (record: Record<string, unknown>) => record.type === 'bridge_status' ? (record.session as { sessionFile?: string; }).sessionFile : undefined;
    expect(sessionFile(await client.next(record => sessionFile(record) !== undefined))).toBe(path.join(workspace, 'session-0.jsonl'));
    client.send({ type: 'new_session' });
    await client.next(record => sessionFile(record) === path.join(workspace, 'session-1.jsonl'));
    expect(agent?.manager.session?.info.sessionFile).toBe(path.join(workspace, 'session-1.jsonl'));
  });

  it('resumes a session file of the folder it starts in, and starts a new conversation for any other', async () => {
    const { base, port, workspace } = await start();
    const header = (cwd: string) => `${JSON.stringify({ type: 'session', version: 3, id: 'x', cwd })}\n`;
    const own = path.join(workspace, 'own.jsonl');
    fs.writeFileSync(own, header(workspace));
    const other = path.join(workspace, 'other.jsonl');
    fs.writeFileSync(other, header(os.tmpdir()));
    const plain = path.join(workspace, 'own.txt');
    fs.writeFileSync(plain, header(workspace));
    expect(resumableSession(own, workspace)).toBe(own);
    expect([resumableSession(other, workspace), resumableSession(plain, workspace), resumableSession(path.join(workspace, 'gone.jsonl'), workspace), resumableSession('own.jsonl', workspace), resumableSession(42, workspace)]).toEqual([undefined, undefined, undefined, undefined, undefined]);

    await post(base, 'POST', { repository: 'home', folder: '', sessionFile: own });
    const client = connect(port, base);
    await client.opened;
    client.send({ type: 'prompt', message: 'args' });
    const reply = JSON.parse(assistantText(await client.next(record => record.type === 'message_end'))) as { args: string[]; };
    expect(reply.args).toEqual(['--mode', 'rpc', '--extension', TRUST_EXTENSION, '--append-system-prompt', WEB_CHAT_PROMPT, '--session', own]);
    await client.next(record => record.type === 'bridge_status' && (record.session as { sessionFile?: string; }).sessionFile === own);

    await post(base, 'DELETE', {});
    await post(base, 'POST', { repository: 'home', folder: '', sessionFile: other });
    const fresh = connect(port, base);
    await fresh.opened;
    fresh.send({ type: 'prompt', message: 'args' });
    expect((JSON.parse(assistantText(await fresh.next(record => record.type === 'message_end'))) as { args: string[]; }).args).not.toContain('--session');
  });

  it('keeps sessions inside the home directory', async () => {
    const { base } = await start();
    expect((await post(base, 'PUT', { repository: 'other', folder: '' })).status).toBe(404);
    expect((await post(base, 'PUT', { repository: 'home', folder: 'missing' })).status).toBe(400);
    expect(() => resolveAgentCwd('relative/path')).toThrow('absolute');
    expect(() => resolveAgentCwd(path.join(os.homedir(), 'no-such-folder-mygitnotes'))).toThrow('does not exist');
  });
});

describe('agent clients', () => {
  const env = { MYGITNOTES_REMOTE_ORIGIN: 'https://desk.tail.ts.net', MYGITNOTES_REMOTE_OWNER: 'me@example.com' };
  const request = (headers: Record<string, string>) => ({ headers: { host: 'localhost:4321', ...headers } });

  it('admits this computer, and through dev:remote only the login that owns it', () => {
    expect(agentClientAllowed(request({ origin: 'http://localhost:5173' }), env)).toBe(true);
    expect(agentClientAllowed(request({ origin: 'https://desk.tail.ts.net', 'tailscale-user-login': 'me@example.com' }), env)).toBe(true);
    expect(agentClientAllowed(request({ 'tailscale-user-login': 'me@example.com' }), env)).toBe(true);
    expect(agentClientAllowed(request({ origin: 'https://desk.tail.ts.net', 'tailscale-user-login': 'guest@example.com' }), env)).toBe(false);
    expect(agentClientAllowed(request({ origin: 'https://evil.example', 'tailscale-user-login': 'me@example.com' }), env)).toBe(false);
    // A tagged device has no login; its writes carry the tailnet origin and are refused.
    expect(agentClientAllowed(request({ origin: 'https://desk.tail.ts.net' }), env)).toBe(false);
    // Without dev:remote naming an owner, a request through Serve is refused even from the owner.
    expect(agentClientAllowed(request({ origin: 'https://desk.tail.ts.net', 'tailscale-user-login': 'me@example.com' }), {})).toBe(false);
    expect(agentClientAllowed({ headers: { host: 'desk.tail.ts.net', origin: 'http://localhost:5173' } }, env)).toBe(false);
  });
});

describe('agent workspaces', () => {
  it('starts Pi only at a repository root or in a folder that holds core instructions', async () => {
    temp = fs.mkdtempSync(path.join(os.homedir(), '.mygitnotes-pi-agent-test-'));
    const root = fs.realpathSync(temp);
    fs.writeFileSync(path.join(root, 'fake-pi.cjs'), FAKE_PI);
    const command = path.join(root, 'fake-pi');
    fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, 'fake-pi.cjs')}" "$@"\n`, { mode: 0o755 });
    for (const folder of ['blog/posts/drafts', 'apps']) fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/AGENTS.md'), '# Not a workspace\n');
    const config = { notebooks: [{ id: 'blog', title: 'Blog', root: 'blog/posts' }] };
    const workspace = {
      defaultRepository: async () => ({ ref: { id: 'home' }, alias: 'home', handle: { kind: 'local', id: 'home', root } }),
      byId: async () => {
        throw new SourceError('Unknown repository.', 404);
      },
      scope: async () => config,
    };
    agent = createPiAgent({ command });
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.workspace = workspace;
      next();
    });
    app.use('/api/pi', agent.router);
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
    const put = (body: unknown) => post(base, 'PUT', body);

    expect((await put({ folder: 'blog/posts/drafts' })).status).toBe(404);
    expect((await put({ folder: 'apps' })).status).toBe(403);
    expect((await put({ folder: '../outside' })).status).toBe(403);
    expect((await put({ repository: 'elsewhere', folder: '' })).status).toBe(404);
    const rooted = await (await put({ folder: '' })).json() as { session: { cwd: string; location: unknown; }; };
    expect(rooted.session).toMatchObject({ cwd: root, location: { repository: 'home', folder: '' } });
    fs.writeFileSync(path.join(root, 'blog/posts/drafts/AGENTS.md'), '# Drafts\n');
    const drafts = await (await put({ folder: 'blog/posts/drafts' })).json() as { session: { cwd: string; location: unknown; }; };
    expect(drafts.session).toMatchObject({ cwd: path.join(root, 'blog/posts/drafts'), location: { repository: 'home', folder: 'blog/posts/drafts' } });
  });
});

describe('Pi detection', () => {
  it('finds Pi by path or on PATH, and refuses to start a session without it', async () => {
    const { workspace } = await start();
    expect(commandAvailable(path.join(workspace, 'fake-pi'))).toBe(true);
    expect(commandAvailable(path.join(workspace, 'fake-pi.cjs'))).toBe(false);
    expect(commandAvailable('fake-pi', { PATH: `/no/such/dir${path.delimiter}${workspace}` })).toBe(true);
    expect(commandAvailable('fake-pi', { PATH: '/no/such/dir' })).toBe(false);

    const missing = createPiAgent({ command: path.join(workspace, 'no-pi-here') });
    expect(missing.manager.available).toBe(false);
    await expect(missing.manager.ensure(async () => ({ cwd: workspace, location: { repository: 'home', folder: '' } }))).rejects.toThrow('Pi is not installed on this computer.');
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

describe('web agent note tools', () => {
  const ask = async (client: ReturnType<typeof connect>, message: string) => {
    client.send({ id: message, type: 'prompt', message });
    const { status, body } = JSON.parse(assistantText(await client.next(record => record.type === 'message_end' && assistantText(record).includes(`"message":"${message}","status"`))));
    return { status, body } as { status: number; body: Record<string, unknown>; };
  };

  it("gives Pi the tools extension and relays its calls to the page holding the panel, answering with the page's result", async () => {
    const { base, port } = await start({ webTools: true });
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    client.send({ id: 'argv', type: 'prompt', message: 'argv' });
    const args = JSON.parse(assistantText(await client.next(record => record.type === 'message_end'))).args as string[];
    expect(args).toEqual(expect.arrayContaining(['--extension', WEB_TOOLS_EXTENSION]));
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(`${WEB_CHAT_PROMPT}\n${WEB_TOOLS_PROMPT}`);
    const answered = ask(client, 'tool read');
    const request = await client.next(record => record.type === 'web_tool_request');
    expect(request).toMatchObject({ tool: 'read_note', arguments: { path: 'notes/a.md' } });
    client.send({ type: 'web_tool_response', id: request.id, result: { source: 'working', content: '# A' } });
    expect(await answered).toEqual({ status: 200, body: { result: { source: 'working', content: '# A' } } });
  });

  it("passes on the page's refusal, and refuses a call without the session's token or without a page", async () => {
    const { base, port } = await start({ webTools: true });
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    const refused = ask(client, 'tool refused');
    const request = await client.next(record => record.type === 'web_tool_request');
    client.send({ type: 'web_tool_response', id: request.id, error: 'The person is editing this note.' });
    expect(await refused).toEqual({ status: 409, body: { error: 'The person is editing this note.' } });
    expect(await ask(client, 'tool forged')).toEqual({ status: 401, body: { error: 'Unknown note tool session.' } });
    await expect(agent!.manager.session!.callWebTool('read_note', {}, 50)).rejects.toThrow('did not answer');
    client.socket.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    await expect(agent!.manager.session!.callWebTool('read_note', {})).rejects.toThrow('Open MyGitNotes in a browser');
  });

  it('fails a call when the page that was asked leaves first', async () => {
    const { base, port } = await start({ webTools: true });
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    await client.next(record => record.type === 'bridge_status');
    const pending = agent!.manager.session!.callWebTool('read_note', {});
    await client.next(record => record.type === 'web_tool_request');
    client.socket.close();
    await expect(pending).rejects.toThrow('closed before it answered');
  });

  it('offers neither the tools nor their route without webTools', async () => {
    const { base, port } = await start();
    await post(base, 'POST');
    const client = connect(port, base);
    await client.opened;
    client.send({ id: 'argv', type: 'prompt', message: 'argv' });
    const args = JSON.parse(assistantText(await client.next(record => record.type === 'message_end'))).args as string[];
    expect(args).not.toContain(WEB_TOOLS_EXTENSION);
    expect((await fetch(`${base}/api/pi/web-tools`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
  });
});
