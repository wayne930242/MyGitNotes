import { agentFolder, INSTRUCTIONS_FILE, resolveSafePath, SourceError } from '@mygitnotes/core';
import express from 'express';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { commandAvailable, piCommand, type PiLocation, PiSession, type PiSessionInfo } from './pi-session.js';
import { asLocal, noteRepository, repositoryOrHome } from './request-workspace.js';

export const PI_SOCKET_PATH = '/api/pi/ws';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function isLoopbackHttpOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOOPBACK_HOSTS.includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * The bridge drives a process that can run any command as this user, so it answers a page served from this
 * machine, and through `pnpm dev:remote` only the tailnet login that owns this machine. Tailscale Serve sets
 * `Tailscale-User-Login` on every request it proxies, replacing any value the client sent, so a request that
 * carries it came through Serve and names who sent it; a tagged device carries none and is refused writes,
 * which always send an Origin.
 */
export function agentClientAllowed(req: Pick<IncomingMessage, 'headers'>, env: NodeJS.ProcessEnv = process.env): boolean {
  const origin = req.headers.origin;
  if (!isLoopbackHost(req.headers.host)) return false;
  const login = req.headers['tailscale-user-login'];
  if (login !== undefined) {
    const remoteOrigin = env.MYGITNOTES_REMOTE_ORIGIN, owner = env.MYGITNOTES_REMOTE_OWNER;
    return Boolean(remoteOrigin && owner) && login === owner && (origin === undefined || origin === remoteOrigin);
  }
  return origin === undefined || isLoopbackHttpOrigin(origin);
}

/** Resolves a requested working folder: an existing directory inside the user's home directory. */
export function resolveAgentCwd(requested: string, home = os.homedir()): string {
  const expanded = requested.trim().replace(/^~(?=$|\/)/, home);
  if (!path.isAbsolute(expanded)) throw new SourceError('The working folder must be an absolute path.');
  let real: string;
  try {
    real = fs.realpathSync(expanded);
  } catch {
    throw new SourceError('The working folder does not exist.');
  }
  if (!fs.statSync(real).isDirectory()) throw new SourceError('The working folder must be a directory.');
  const realHome = fs.realpathSync(home);
  if (real !== realHome && !real.startsWith(`${realHome}${path.sep}`)) throw new SourceError('The working folder must be inside your home directory.', 403);
  return real;
}

export interface AgentFolder {
  cwd: string;
  location: PiLocation;
}

const SESSION_HEADER_LIMIT = 64 * 1024;

/**
 * The session file a start may resume: an existing Pi session file inside the home directory whose header
 * records `cwd` as its folder. Anything else (gone, moved, another folder's) is not resumable, and Pi starts
 * a new conversation instead.
 */
export function resumableSession(file: unknown, cwd: string): string | undefined {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.jsonl')) return undefined;
  try {
    const real = fs.realpathSync(file);
    const home = fs.realpathSync(os.homedir());
    if (!real.startsWith(`${home}${path.sep}`) || !fs.statSync(real).isFile()) return undefined;
    const handle = fs.openSync(real, 'r');
    const buffer = Buffer.alloc(SESSION_HEADER_LIMIT);
    const length = fs.readSync(handle, buffer, 0, SESSION_HEADER_LIMIT, 0);
    fs.closeSync(handle);
    const header = JSON.parse(buffer.subarray(0, length).toString('utf8').split('\n', 1)[0]) as { type?: unknown; cwd?: unknown; };
    return header.type === 'session' && typeof header.cwd === 'string' && fs.realpathSync(header.cwd) === cwd ? real : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves the agent workspace the panel picked, the repository root or a folder holding core instructions, to the directory Pi starts in. */
async function workspaceFolder(res: express.Response, repository: unknown, folder: unknown): Promise<AgentFolder> {
  if (typeof folder !== 'string') throw new SourceError('folder must be a repository-relative folder, empty for the root.');
  const { id, handle, config } = await repositoryOrHome(res, repository);
  const root = asLocal(handle).root;
  if (folder) {
    if (!agentFolder(folder, config.notebooks)) throw new SourceError('That folder cannot be an agent workspace.', 403);
    const instructions = resolveSafePath(root, `${folder}/${INSTRUCTIONS_FILE}`);
    if (!fs.existsSync(instructions) || !fs.lstatSync(instructions).isFile()) throw new SourceError('That folder is not an agent workspace yet.', 404);
  }
  return { cwd: resolveAgentCwd(folder ? resolveSafePath(root, folder) : root), location: { repository: id, folder } };
}

/** The one Pi process the notebook's agent panel talks to. It starts in the background and ends only when asked. */
export class PiSessionManager {
  private current: PiSession | undefined;
  private readonly command: string;
  constructor(command?: string) {
    this.command = command ?? piCommand();
  }

  /** Whether Pi is installed where this server can start it; checked on each call, so installing Pi needs no restart. */
  get available(): boolean {
    return commandAvailable(this.command);
  }

  get session(): PiSession | undefined {
    return this.current;
  }

  /**
   * Returns the live session, starting one in the resolved folder when there is none; `resolve` runs only then.
   * A start resumes `resume` when it is a session file of that folder (see resumableSession).
   */
  async ensure(resolve: () => Promise<AgentFolder>, resume?: unknown): Promise<PiSession> {
    if (this.current?.alive) return this.current;
    this.assertAvailable();
    const folder = await resolve();
    if (this.current?.alive) return this.current;
    this.current = new PiSession({ ...folder, resume: resumableSession(resume, folder.cwd), command: this.command });
    return this.current;
  }

  /** Ends the live session and starts a fresh one in `folder`; its conversation does not carry over. */
  async restart(folder: AgentFolder): Promise<PiSession> {
    this.assertAvailable();
    await this.end();
    this.current = new PiSession({ ...folder, command: this.command });
    return this.current;
  }

  private assertAvailable() {
    if (!this.available) throw new SourceError('Pi is not installed on this computer.', 503);
  }

  async end(): Promise<void> {
    const session = this.current;
    this.current = undefined;
    await session?.end();
  }
}

export interface PiAgent {
  router: express.Router;
  /**
   * Handles the HTTP server's `upgrade` event for the agent socket; other paths are left to other handlers.
   * An agent that runs no socket of its own (one reached through `PiSessionInfo.socket`) leaves it out.
   */
  upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}

export interface PiAgentOptions {
  command?: string;
  /** Resolves the agent workspace a request names; defaults to one of the request's local repositories. */
  resolveFolder?: (res: express.Response, repository: unknown, folder: unknown) => Promise<AgentFolder>;
}

function sessionBody(session: PiSession | undefined): { session: PiSessionInfo | null; } {
  return { session: session?.info ?? null };
}

function fail(res: express.Response, error: unknown) {
  const status = error instanceof SourceError ? error.status : (error as { status?: number; }).status || 500;
  res.status(status).json({ error: (error as Error).message });
}

/** The local agent bridges its own socket and keeps its session in a local process, so unlike any `PiAgent`, it always has `upgrade` and a `manager`. */
export function createPiAgent({ command, resolveFolder = workspaceFolder }: PiAgentOptions = {}): PiAgent & { upgrade: NonNullable<PiAgent['upgrade']>; manager: PiSessionManager; } {
  const manager = new PiSessionManager(command);
  const router = express.Router();
  router.use((req, res, next) => agentClientAllowed(req) ? next() : res.status(403).json({ error: 'The agent panel is available only from this computer, or to its owner through pnpm dev:remote.' }));
  // Pi only ever starts in an agent workspace, never at a path the request spells out.
  const requestedFolder = (req: express.Request, res: express.Response) => resolveFolder(res, req.body?.repository, req.body?.folder);

  router.get('/session', (_req, res) => {
    res.json({ ...sessionBody(manager.session), piAvailable: manager.available });
  });
  router.post('/session', async (req, res) => {
    try {
      res.json(sessionBody(await manager.ensure(() => requestedFolder(req, res), req.body?.sessionFile)));
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/session', async (req, res) => {
    try {
      res.json(sessionBody(await manager.restart(await requestedFolder(req, res))));
    } catch (error) {
      fail(res, error);
    }
  });
  router.delete('/session', async (_req, res) => {
    await manager.end();
    res.json(sessionBody(undefined));
  });
  /** The absolute path of a note, which the panel names to Pi as the file in focus. */
  router.get('/locate', async (req, res) => {
    try {
      const file = req.query.path;
      const { handle } = await noteRepository(res, file, req.query.notebookId);
      res.json({ file: resolveSafePath(asLocal(handle).root, String(file)) });
    } catch (error) {
      fail(res, error);
    }
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== PI_SOCKET_PATH) return false;
    const session = manager.session;
    const refuse = (status: string) => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (!agentClientAllowed(req) || req.headers.origin === undefined) refuse('403 Forbidden');
    else if (!session) refuse('409 Conflict');
    else {
      sockets.handleUpgrade(req, socket, head, ws => {
        const detach = session.attach({ send: text => ws.send(text), close: () => ws.close(1000, 'Pi session ended') });
        ws.on('message', (data, isBinary) => {
          const problem = isBinary ? 'Commands must be text frames.' : session.forward(data.toString());
          if (problem) ws.send(JSON.stringify({ type: 'bridge_error', error: problem }));
        });
        ws.on('close', detach);
      });
    }
    return true;
  };
  return { router, upgrade, manager };
}
