import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

/** What the panel sees of the bridged Pi process. */
export interface PiSessionInfo {
  id: string;
  cwd: string;
  /** The notebook folder the panel picked as `cwd`; `folder` is relative to the notebook root, null for the root. */
  location: PiLocation;
  /** Pi's own project-trust decision for `cwd`, once it reports it; Pi makes it from trust.json and its extensions. */
  trusted?: boolean;
  /** The MCP servers pi-mcp-adapter has configured and how each stands, once the adapter reports them. */
  mcpServers?: PiMcpServer[];
  /** The session file Pi records this conversation in, once Pi reports it; a later start resumes from it. */
  sessionFile?: string;
  status: 'starting' | 'ready' | 'exited';
  pid?: number;
  startedAt: string;
  exit?: { code: number | null; signal: string | null; stderr: string; };
}

export interface PiLocation {
  notebookId: string;
  folder: string | null;
  /** Pi runs at the root of the notebook's repository, the whole project, rather than in the notebook. */
  repository?: true;
}

export interface PiMcpServer {
  name: string;
  /** pi-mcp-adapter's runtime status: connected, cached, not-connected, needs-auth, failed, disabled or blocked. */
  status: string;
  toolCount: number;
  /** Why a project server is blocked (untrusted, approval required, denied). */
  blockedReason?: string;
}

/** A connected client: receives Pi's stdout records and bridge notices as JSON text. */
export interface PiSessionListener {
  send: (text: string) => void;
  close: () => void;
}

/** Commands a client may forward to Pi; everything else on the RPC surface stays out of the browser's reach. */
const CLIENT_COMMANDS = new Set(['prompt', 'steer', 'follow_up', 'abort', 'clear_queue', 'new_session', 'get_state', 'get_messages', 'extension_ui_response', 'get_available_models', 'set_model', 'get_available_thinking_levels', 'set_thinking_level']);
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);
/** Fire-and-forget UI state keyed by extension; the latest of each is replayed to a client that attaches later. */
const STATE_KEYS: Record<string, string> = { setStatus: 'statusKey', setWidget: 'widgetKey' };
const READY_PROBE_ID = 'mygitnotes-bridge-ready';
/** Re-reads the session file after Pi starts a new conversation, which records into a new one. */
const STATE_PROBE_ID = 'mygitnotes-bridge-state';
/** The extension that reports Pi's project-trust decision, and the status key it reports it under (kept equal to its TRUST_STATUS_KEY). */
export const TRUST_EXTENSION = fileURLToPath(new URL('./pi-trust-extension.mjs', import.meta.url));
export const TRUST_STATUS_KEY = 'mygitnotes-project-trust';
/** The status key the same extension relays pi-mcp-adapter's server list under (kept equal to its MCP_STATUS_KEY). */
export const MCP_STATUS_KEY = 'mygitnotes-mcp-servers';
const STDERR_LIMIT = 8000;
const SHUTDOWN_GRACE_MS = 5000;
const KILL_GRACE_MS = 3000;

export function piCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.MYGITNOTES_PI_COMMAND?.trim() || 'pi';
}

const isExecutable = (file: string) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Whether `command` names an executable: a path to one, or a name found on PATH. */
export function commandAvailable(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (command.includes('/')) return isExecutable(command);
  return (env.PATH ?? '').split(path.delimiter).filter(Boolean).some(dir => isExecutable(path.join(dir, command)));
}

/** Splits a byte stream into JSONL records on LF only; Node's readline would also split on U+2028/U+2029 inside JSON strings. */
export function jsonlSplitter(onRecord: (line: string) => void) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return (chunk: Buffer) => {
    pending += decoder.write(chunk);
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (line.trim()) onRecord(line);
      newline = pending.indexOf('\n');
    }
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the relayed server list, keeping only well-formed entries; anything unreadable reports no list. */
function parseMcpServers(text: unknown): PiMcpServer[] | undefined {
  let value: unknown;
  try {
    value = typeof text === 'string' ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
  if (!Array.isArray(value)) return undefined;
  return value.flatMap(entry => isRecord(entry) && typeof entry.name === 'string' && typeof entry.status === 'string' ? [{ name: entry.name, status: entry.status, toolCount: typeof entry.toolCount === 'number' ? entry.toolCount : 0, ...(typeof entry.blockedReason === 'string' ? { blockedReason: entry.blockedReason } : {}) }] : []);
}

/** One `pi --mode rpc` process. It outlives the sockets attached to it and ends only through `end()` or its own exit. */
export class PiSession {
  readonly info: PiSessionInfo;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<PiSessionListener>();
  /** Dialog requests still waiting for an answer, replayed to a client that attaches later. */
  private readonly openDialogs = new Map<string, string>();
  private readonly uiState = new Map<string, string>();
  private readonly exited: Promise<void>;
  private stderr = '';

  /** `resume` names a session file to continue; without it Pi starts a new conversation. */
  constructor({ cwd, location, resume, command = piCommand(), onExit }: { cwd: string; location: PiLocation; resume?: string; command?: string; onExit?: (session: PiSession) => void; }) {
    this.info = { id: randomUUID(), cwd, location, status: 'starting', startedAt: new Date().toISOString() };
    // No --approve: project trust stays Pi's decision, as it is in the user's terminal.
    const args = ['--mode', 'rpc', '--extension', TRUST_EXTENSION, ...resume ? ['--session', resume] : []];
    this.child = spawn(command, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.info.pid = this.child.pid;
    this.child.stdout.on('data', jsonlSplitter(line => this.receive(line)));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT);
    });
    // A failed spawn emits 'error' and may never emit 'exit'; either one settles the session.
    this.exited = new Promise(resolve => {
      const settle = (code: number | null, signal: string | null, failure?: Error) => {
        if (this.info.status === 'exited') return;
        this.info.status = 'exited';
        this.info.exit = { code, signal, stderr: failure ? `${failure.message}\n${this.stderr}`.trim() : this.stderr };
        this.openDialogs.clear();
        this.broadcastStatus();
        for (const listener of this.listeners) listener.close();
        this.listeners.clear();
        onExit?.(this);
        resolve();
      };
      this.child.once('exit', (code, signal) => settle(code, signal));
      this.child.once('error', error => settle(null, null, error));
    });
    this.child.stdin.on('error', () => {});
    this.write({ id: READY_PROBE_ID, type: 'get_state' });
  }

  get alive(): boolean {
    return this.info.status !== 'exited';
  }

  attach(listener: PiSessionListener): () => void {
    listener.send(JSON.stringify({ type: 'bridge_status', session: this.info }));
    for (const request of this.openDialogs.values()) listener.send(request);
    for (const record of this.uiState.values()) listener.send(record);
    if (!this.alive) {
      listener.close();
      return () => {};
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forwards one client frame; returns an error message when the frame is not an allowed command. */
  forward(text: string): string | undefined {
    let command: unknown;
    try {
      command = JSON.parse(text);
    } catch {
      return 'Commands must be JSON objects.';
    }
    if (!isRecord(command) || typeof command.type !== 'string' || !CLIENT_COMMANDS.has(command.type)) return 'Command is not allowed.';
    if (!this.alive) return 'The Pi session has ended.';
    if (command.type === 'extension_ui_response' && typeof command.id === 'string' && this.openDialogs.delete(command.id)) {
      this.broadcast(JSON.stringify({ type: 'bridge_ui_resolved', id: command.id }));
    }
    this.write(command);
    return undefined;
  }

  /** Closes stdin for Pi's orderly shutdown, then escalates to signals if it lingers. */
  async end(): Promise<void> {
    if (this.alive) {
      this.child.stdin.end();
      const term = setTimeout(() => this.child.kill('SIGTERM'), SHUTDOWN_GRACE_MS);
      const kill = setTimeout(() => this.child.kill('SIGKILL'), SHUTDOWN_GRACE_MS + KILL_GRACE_MS);
      await this.exited;
      clearTimeout(term);
      clearTimeout(kill);
    }
  }

  private write(command: Record<string, unknown>) {
    if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private receive(line: string) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(record)) return;
    if (record.type === 'response' && record.command === 'get_state') this.noteSessionFile(record.data);
    if (record.type === 'response' && (record.id === READY_PROBE_ID || record.id === STATE_PROBE_ID)) {
      if (this.info.status === 'starting') {
        this.info.status = 'ready';
        this.broadcastStatus();
      }
      return;
    }
    if (record.type === 'response' && record.command === 'new_session' && record.success === true) this.write({ id: STATE_PROBE_ID, type: 'get_state' });
    if (record.type === 'extension_ui_request' && typeof record.id === 'string' && DIALOG_METHODS.has(String(record.method))) {
      const id = record.id;
      this.openDialogs.set(id, line);
      // Pi resolves a timed dialog itself; drop it so a later client is not shown a stale question.
      if (typeof record.timeout === 'number') setTimeout(() => this.openDialogs.delete(id), record.timeout).unref();
    }
    if (record.type === 'extension_ui_request' && record.method === 'setStatus' && record.statusKey === TRUST_STATUS_KEY) {
      this.info.trusted = record.statusText === 'trusted';
      this.broadcastStatus();
      return;
    }
    if (record.type === 'extension_ui_request' && record.method === 'setStatus' && record.statusKey === MCP_STATUS_KEY) {
      this.info.mcpServers = parseMcpServers(record.statusText);
      this.broadcastStatus();
      return;
    }
    const stateKey = record.type === 'extension_ui_request' ? STATE_KEYS[String(record.method)] : undefined;
    if (stateKey && typeof record[stateKey] === 'string') {
      const key = `${String(record.method)}:${record[stateKey]}`;
      // A record without a value clears that key, so nothing is replayed for it.
      if (record.statusText === undefined && record.widgetLines === undefined) this.uiState.delete(key);
      else this.uiState.set(key, line);
    }
    this.broadcast(line);
  }

  private noteSessionFile(data: unknown) {
    const file = isRecord(data) && typeof data.sessionFile === 'string' ? data.sessionFile : undefined;
    if (!file || file === this.info.sessionFile) return;
    this.info.sessionFile = file;
    if (this.info.status !== 'starting') this.broadcastStatus();
  }

  private broadcastStatus() {
    this.broadcast(JSON.stringify({ type: 'bridge_status', session: this.info }));
  }

  private broadcast(text: string) {
    for (const listener of this.listeners) listener.send(text);
  }
}
