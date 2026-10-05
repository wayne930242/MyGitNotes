import { resolveSafePath, SourceError } from '@mygitnotes/core';
import express from 'express';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { commandAvailable, piCommand, PiSession, type PiSessionInfo } from './pi-session.js';
import { asLocal, eachRepository, localHome, noteRepository } from './request-workspace.js';

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
 * The bridge drives a process that can run any command as this user, so only a page served from this
 * machine may reach it: the tailnet origin that `pnpm dev:remote` admits for notes is refused here.
 */
function loopbackOnly(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return isLoopbackHost(req.headers.host) && (origin === undefined || isLoopbackHttpOrigin(origin));
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

  /** Returns the live session, starting one in `cwd` when there is none. */
  ensure(cwd: string, approve: boolean): PiSession {
    if (this.current?.alive) return this.current;
    this.assertAvailable();
    this.current = new PiSession({ cwd, approve, command: this.command });
    return this.current;
  }

  /** Ends the live session and starts a fresh one in `cwd`; its conversation does not carry over. */
  async restart(cwd: string, approve: boolean): Promise<PiSession> {
    this.assertAvailable();
    await this.end();
    this.current = new PiSession({ cwd, approve, command: this.command });
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
  /** The folder a session starts in when the request names none; defaults to the local home repository. */
  defaultCwd?: (res: express.Response) => string;
}

function sessionBody(session: PiSession | undefined): { session: PiSessionInfo | null; } {
  return { session: session?.info ?? null };
}

function fail(res: express.Response, error: unknown) {
  const status = error instanceof SourceError ? error.status : (error as { status?: number; }).status || 500;
  res.status(status).json({ error: (error as Error).message });
}

export function createPiAgent({ command, defaultCwd = res => localHome(res).root }: PiAgentOptions = {}): PiAgent {
  const manager = new PiSessionManager(command);
  const router = express.Router();
  router.use((req, res, next) => loopbackOnly(req) ? next() : res.status(403).json({ error: 'The agent panel is available only from this computer.' }));
  const requestedCwd = (req: express.Request, res: express.Response) => resolveAgentCwd(typeof req.body?.cwd === 'string' && req.body.cwd.trim() ? req.body.cwd : defaultCwd(res));

  router.get('/session', async (_req, res) => {
    try {
      const roots = (await eachRepository(res)).map(({ handle }) => asLocal(handle).root);
      res.json({ ...sessionBody(manager.session), piAvailable: manager.available, defaultCwd: defaultCwd(res), workspaceRoots: [...new Set(roots)] });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/session', (req, res) => {
    try {
      res.json(sessionBody(manager.ensure(requestedCwd(req, res), req.body?.approve === true)));
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/session', async (req, res) => {
    try {
      if (typeof req.body?.cwd !== 'string' || !req.body.cwd.trim()) throw new SourceError('cwd is required.');
      res.json(sessionBody(await manager.restart(requestedCwd(req, res), req.body?.approve === true)));
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
    if (!loopbackOnly(req) || req.headers.origin === undefined) refuse('403 Forbidden');
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
