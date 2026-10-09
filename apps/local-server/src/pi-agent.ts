import { agentFolder, INSTRUCTIONS_FILE, resolveSafePath, SourceError } from '@mygitnotes/core';
import express from 'express';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { commandAvailable, piCommand, type PiLocation, PiSession, type PiSessionInfo, resumableSession, WebToolError } from './pi-session.js';
import { membershipGeneration } from './event-stream.js';
import { asLocal, noteRepository, repositoryOrDefault } from './request-workspace.js';

export const PI_SOCKET_PATH = '/api/pi/ws';
/** Where Pi's note tools call the bridge, below the agent router. */
export const WEB_TOOLS_PATH = '/web-tools';
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

export { resumableSession } from './pi-session.js';

/** Resolves the agent workspace the panel picked, the repository root or a folder holding core instructions, to the directory Pi starts in. */
async function workspaceFolder(res: express.Response, repository: unknown, folder: unknown): Promise<AgentFolder> {
  if (typeof folder !== 'string') throw new SourceError('folder must be a repository-relative folder, empty for the root.');
  const { id, handle, config } = await repositoryOrDefault(res, repository);
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
  /** Where a session started now reaches the bridge for its note tools; unset, Pi keeps its own file tools. */
  webTools: { url: string; } | undefined;

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
    this.current = new PiSession({ ...folder, resume: resumableSession(resume, folder.cwd), command: this.command, webTools: this.webTools });
    return this.current;
  }

  /**
   * Ends the live session and starts a fresh one in `folder`; its conversation does not carry over. `beforeStart` runs
   * once the old session has ended and may refuse the start by throwing.
   */
  async restart(folder: AgentFolder, beforeStart?: () => void): Promise<PiSession> {
    this.assertAvailable();
    await this.end();
    beforeStart?.();
    this.current = new PiSession({ ...folder, command: this.command, webTools: this.webTools });
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

  /**
   * Ends the live session when its repository is no longer a visible member of the workspace, since Pi's own tools
   * would keep reading that worktree. The ended session stays current, so the panel can say why it ended.
   */
  async leaveHidden(visible: readonly string[]): Promise<void> {
    const session = this.current;
    if (session?.alive && !visible.includes(session.info.location.repository)) await session.end('repository-hidden');
  }
}

export interface PiAgent {
  router: express.Router;
  /**
   * Answers Pi's own calls (the web agent's note tools), which carry the session's token and no sign-in, so it is
   * mounted at `/api/pi` ahead of the workspace a signed-in request opens.
   */
  tools?: express.Router;
  /**
   * Handles the HTTP server's `upgrade` event for the agent socket; other paths are left to other handlers.
   * An agent that runs no socket of its own (one reached through `PiSessionInfo.socket`) leaves it out.
   */
  upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  /**
   * Hears that the workspace's members changed, with the repositories still visible; a session working in a repository
   * that was hidden or removed ends, so it stops reading it. An agent that runs nothing locally may leave it out.
   */
  membershipChanged?: (visible: string[]) => Promise<void>;
}

export interface PiAgentOptions {
  command?: string;
  /**
   * Gives Pi note tools that edit the working changes of the page holding the panel, for an agent of a remote
   * workspace, whose notes are not files Pi could edit. Pi reaches them at `/api/pi/web-tools` on this server.
   */
  webTools?: boolean;
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
export function createPiAgent({ command, resolveFolder = workspaceFolder, webTools = false }: PiAgentOptions = {}): PiAgent & { upgrade: NonNullable<PiAgent['upgrade']>; manager: PiSessionManager; membershipChanged: NonNullable<PiAgent['membershipChanged']>; } {
  const manager = new PiSessionManager(command);
  const router = express.Router();
  // Pi's note tools call in from the Pi process with the session's token rather than from a page or a signed-in person.
  const tools = webTools ? express.Router() : undefined;
  if (tools) {
    tools.post(WEB_TOOLS_PATH, async (req, res) => {
      const session = manager.session;
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (!session?.acceptsWebToolToken(token)) return res.status(401).json({ error: 'Unknown note tool session.' });
      const { tool, arguments: args } = req.body ?? {};
      if (typeof tool !== 'string') return res.status(400).json({ error: 'Name a tool.' });
      try {
        res.json({ result: await session.callWebTool(tool, args ?? {}) });
      } catch (error) {
        res.status(error instanceof WebToolError ? error.status : 500).json({ error: (error as Error).message });
      }
    });
  }
  // A session started from a request reaches this server on the port that request arrived at.
  const noteWebTools = (req: express.Request) => {
    if (webTools) manager.webTools = { url: `http://127.0.0.1:${req.socket.localPort}${req.baseUrl}${WEB_TOOLS_PATH}` };
  };
  router.use((req, res, next) => agentClientAllowed(req) ? next() : res.status(403).json({ error: 'The agent panel is available only from this computer, or to its owner through pnpm dev:remote.' }));
  /**
   * Refuses a start when the workspace's members changed after this request read them: the folder it resolved may lie in
   * a repository just hidden, which `membershipChanged` could not end a session in since none had started yet.
   */
  const assertMembersUnchanged = (res: express.Response) => {
    const startedUnder = res.locals.membershipGeneration;
    if (typeof startedUnder === 'number' && startedUnder !== membershipGeneration()) throw new SourceError("The workspace's repositories changed while the agent was starting. Start it again.", 409);
  };
  // Pi only ever starts in an agent workspace, never at a path the request spells out.
  const requestedFolder = async (req: express.Request, res: express.Response) => {
    const folder = await resolveFolder(res, req.body?.repository, req.body?.folder);
    assertMembersUnchanged(res);
    return folder;
  };

  router.get('/session', (_req, res) => {
    res.json({ ...sessionBody(manager.session), piAvailable: manager.available });
  });
  router.post('/session', async (req, res) => {
    try {
      noteWebTools(req);
      res.json(sessionBody(await manager.ensure(() => requestedFolder(req, res), req.body?.sessionFile)));
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/session', async (req, res) => {
    try {
      noteWebTools(req);
      res.json(sessionBody(await manager.restart(await requestedFolder(req, res), () => assertMembersUnchanged(res))));
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
  return { router, tools, upgrade, manager, membershipChanged: visible => manager.leaveHidden(visible) };
}
