import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { type PiLocation, PiSession, type PiSessionInfo, resumableSession } from './pi-session.js';

/** The WebSocket subprotocol a client offers to present the bridge token, since a browser's WebSocket cannot set headers. */
export const BRIDGE_PROTOCOL_PREFIX = 'mygitnotes-bridge.';
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const ACTIVITY_INTERVAL_MS = 60_000;

export interface PiBridgeOptions {
  port: number;
  host?: string;
  /** What every client presents: a bearer token over HTTP, the subprotocol `mygitnotes-bridge.<token>` on the socket. */
  token: string;
  /** The origin a browser reaches this bridge at, named in the session's `socket`. */
  publicUrl: string;
  /** Page origins whose sockets are accepted; empty accepts any origin that presents the token. */
  allowedOrigins?: string[];
  /** The directory Pi starts in; it holds no notes, which Pi edits through the page. */
  cwd: string;
  command?: string;
  piArgs?: string[];
  env?: Record<string, string>;
  /** Whether a client may run shell commands; off unless asked, since the bridge serves a hosted sandbox. */
  shell?: boolean;
  /** Called at most once per `activityIntervalMs` while a client sends commands or Pi answers, so the host can keep the sandbox running. */
  activity?: () => void;
  activityIntervalMs?: number;
}

export interface PiBridge {
  url: string;
  session: () => PiSession | undefined;
  close: () => Promise<void>;
}

const sameToken = (expected: string, given: string | undefined) => {
  if (!given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

const isLocation = (value: unknown): value is PiLocation => typeof value === 'object' && value !== null && typeof (value as PiLocation).repository === 'string' && typeof (value as PiLocation).folder === 'string';

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('The request body is too large.'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
}

const reply = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * Runs Pi for one person in a hosted sandbox and serves the web panel's socket protocol on one port, so the panel
 * talks to Pi as it does through the local server. Pi's note tools reach the page through this bridge; the host
 * that started it creates, restarts and ends the session over HTTP with the same token the page presents.
 */
export function startPiBridge(options: PiBridgeOptions): Promise<PiBridge> {
  const { token, cwd, command, piArgs, env, shell = false, allowedOrigins = [], activityIntervalMs = ACTIVITY_INTERVAL_MS } = options;
  const publicUrl = options.publicUrl.replace(/\/$/, '');
  const socket = { url: `${publicUrl.replace(/^http/, 'ws')}/ws`, protocols: [`${BRIDGE_PROTOCOL_PREFIX}${token}`] };
  let current: PiSession | undefined;
  let lastActivity = 0;
  const active = () => {
    if (!options.activity || Date.now() - lastActivity < activityIntervalMs) return;
    lastActivity = Date.now();
    options.activity();
  };
  const info = (session: PiSession | undefined): { session: PiSessionInfo | null; } => ({ session: session ? { ...session.info, socket } : null });
  let webToolsUrl = '';
  const start = (location: PiLocation, resume?: unknown) => {
    current = new PiSession({ cwd, location, resume: resumableSession(resume, cwd), command, piArgs, env, shell, webTools: { url: webToolsUrl } });
    return current;
  };
  const end = async () => {
    const session = current;
    current = undefined;
    await session?.end();
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://bridge').pathname;
      if (path === '/health' && req.method === 'GET') return reply(res, 200, { ok: true });
      const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (path === '/web-tools' && req.method === 'POST') {
        if (!current?.acceptsWebToolToken(bearer)) return reply(res, 401, { error: 'Unknown note tool session.' });
        const { tool, arguments: args } = await readJson(req);
        if (typeof tool !== 'string') return reply(res, 400, { error: 'Name a tool.' });
        try {
          return reply(res, 200, { result: await current.callWebTool(tool, args ?? {}) });
        } catch (error) {
          return reply(res, (error as { status?: number; }).status ?? 500, { error: (error as Error).message });
        }
      }
      if (path !== '/session') return reply(res, 404, { error: 'Not found.' });
      if (!sameToken(token, bearer)) return reply(res, 401, { error: 'Present the bridge token.' });
      if (req.method === 'GET') return reply(res, 200, info(current?.alive ? current : undefined));
      if (req.method === 'DELETE') {
        await end();
        return reply(res, 200, info(undefined));
      }
      const body = await readJson(req);
      if (!isLocation(body.location)) return reply(res, 400, { error: 'Name the agent workspace as { repository, folder }.' });
      if (req.method === 'POST') return reply(res, 200, info(current?.alive ? current : start(body.location, body.sessionFile)));
      if (req.method === 'PUT') {
        await end();
        return reply(res, 200, info(start(body.location)));
      }
      return reply(res, 405, { error: 'Method not allowed.' });
    })().catch(error => reply(res, (error as { status?: number; }).status ?? 400, { error: (error as Error).message }));
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, handleProtocols: protocols => [...protocols].find(entry => sameToken(`${BRIDGE_PROTOCOL_PREFIX}${token}`, entry)) ?? false });
  server.on('upgrade', (req, duplex, head) => {
    const refuse = (status: string) => duplex.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(entry => entry.trim());
    const origin = req.headers.origin;
    if (new URL(req.url ?? '/', 'http://bridge').pathname !== '/ws') return refuse('404 Not Found');
    if (!offered.some(entry => sameToken(`${BRIDGE_PROTOCOL_PREFIX}${token}`, entry))) return refuse('401 Unauthorized');
    if (allowedOrigins.length && (!origin || !allowedOrigins.includes(origin))) return refuse('403 Forbidden');
    const session = current;
    if (!session?.alive) return refuse('409 Conflict');
    sockets.handleUpgrade(req, duplex, head, ws => {
      const detach = session.attach({
        send: text => {
          active();
          ws.send(text);
        },
        close: () => ws.close(1000, 'Pi session ended'),
      });
      ws.on('message', (data, isBinary) => {
        active();
        const problem = isBinary ? 'Commands must be text frames.' : session.forward(data.toString());
        if (problem) ws.send(JSON.stringify({ type: 'bridge_error', error: problem }));
      });
      ws.on('close', detach);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      const { port } = server.address() as AddressInfo;
      webToolsUrl = `http://127.0.0.1:${port}/web-tools`;
      resolve({
        url: `http://127.0.0.1:${port}`,
        session: () => current,
        close: async () => {
          await end();
          for (const client of sockets.clients) client.terminate();
          await new Promise<void>(done => server.close(() => done()));
        },
      });
    });
  });
}
