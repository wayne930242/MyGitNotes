import { resolveSafePath, SourceError } from '@mygitnotes/core';
import express from 'express';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { commandAvailable, piCommand, type PiLocation, PiSession, type PiSessionInfo } from './pi-session.js';
import { asLocal, notebookRepository, noteRepository } from './request-workspace.js';

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

/** Resolves a notebook folder the panel picked to the directory Pi starts in. */
async function notebookFolder(res: express.Response, notebookId: unknown, folder: unknown): Promise<AgentFolder> {
  if (folder !== null && folder !== undefined && (typeof folder !== 'string' || !folder)) throw new SourceError('folder must be a notebook-relative path or null.');
  const { handle, notebook } = await notebookRepository(res, notebookId);
  const root = asLocal(handle).root;
  const relative = folder ? `${notebook.root.replace(/\/$/, '')}/${folder}` : notebook.root;
  return { cwd: resolveAgentCwd(resolveSafePath(root, relative)), location: { notebookId: notebook.id, folder: folder ? String(folder) : null } };
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

  /** Returns the live session, starting one in the resolved folder when there is none; `resolve` runs only then. */
  async ensure(resolve: () => Promise<AgentFolder>, approve: boolean): Promise<PiSession> {
    if (this.current?.alive) return this.current;
    this.assertAvailable();
    const folder = await resolve();
    if (this.current?.alive) return this.current;
    this.current = new PiSession({ ...folder, approve, command: this.command });
    return this.current;
  }

  /** Ends the live session and starts a fresh one in `folder`; its conversation does not carry over. */
  async restart(folder: AgentFolder, approve: boolean): Promise<PiSession> {
    this.assertAvailable();
    await this.end();
    this.current = new PiSession({ ...folder, approve, command: this.command });
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
  /** Handles the HTTP server's `upgrade` event for the agent socket; other paths are left to other handlers. */
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  manager: PiSessionManager;
}

export interface PiAgentOptions {
  command?: string;
  /** Resolves the notebook folder a request names; defaults to the request's local workspace. */
  resolveFolder?: (res: express.Response, notebookId: unknown, folder: unknown) => Promise<AgentFolder>;
}

function sessionBody(session: PiSession | undefined): { session: PiSessionInfo | null; } {
  return { session: session?.info ?? null };
}

function fail(res: express.Response, error: unknown) {
  const status = error instanceof SourceError ? error.status : (error as { status?: number; }).status || 500;
  res.status(status).json({ error: (error as Error).message });
}

export function createPiAgent({ command, resolveFolder = notebookFolder }: PiAgentOptions = {}): PiAgent {
  const manager = new PiSessionManager(command);
  const router = express.Router();
  router.use((req, res, next) => agentClientAllowed(req) ? next() : res.status(403).json({ error: 'The agent panel is available only from this computer, or to its owner through pnpm dev:remote.' }));
  // Pi only ever starts in a notebook folder: the request names the notebook and a folder inside it.
  const requestedFolder = (req: express.Request, res: express.Response) => resolveFolder(res, req.body?.notebookId, req.body?.folder);

  router.get('/session', (_req, res) => {
    res.json({ ...sessionBody(manager.session), piAvailable: manager.available });
  });
  router.post('/session', async (req, res) => {
    try {
      res.json(sessionBody(await manager.ensure(() => requestedFolder(req, res), req.body?.approve === true)));
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/session', async (req, res) => {
    try {
      res.json(sessionBody(await manager.restart(await requestedFolder(req, res), req.body?.approve === true)));
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
