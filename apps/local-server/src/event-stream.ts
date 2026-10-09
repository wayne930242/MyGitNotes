import type { Response } from 'express';

/** Keeps idle event streams open through proxies that close silent connections. */
const HEARTBEAT_MS = 25_000;

/** Every open stream, so a membership change can end them all. */
const open = new Set<Response>();
/** Counts membership changes, so a stream whose request read the members before the latest one never subscribes. */
let generation = 0;
/** Tells a page that the members changed: it reloads the workspace and drops results of repositories that left. */
const MEMBERSHIP_EVENT = `event: change\ndata: ${JSON.stringify({ membership: true })}\n\n`;

/**
 * The membership generation a request starts under; `requestWorkspace` records it in `res.locals.membershipGeneration`
 * before reading the members, so a change made while they are read is noticed.
 */
export function membershipGeneration(): number {
  return generation;
}

/**
 * Tells every open event stream that the membership changed, then ends it. A browser's `EventSource` reconnects on its
 * own, and its new stream subscribes to the workspace as it is now; ending them means no stream keeps watching a
 * repository that left or was hidden, and the event means every page reloads its repositories without waiting for that.
 */
export function endEventStreams(): void {
  generation++;
  for (const res of open) {
    res.write(MEMBERSHIP_EVENT);
    res.end();
  }
}

/**
 * Opens a server-sent event stream once `prepare` has read what it needs, and ends its subscription when the client leaves.
 * A client that leaves while `prepare` still runs gets no stream: the close is heard from the start, so nothing subscribes after it.
 * `prepare` failing answers with `fail`; `subscribe` returns its unsubscribe and writes events through `write`.
 */
export async function openEventStream<T>(res: Response, prepare: () => Promise<T>, fail: (error: unknown) => void, subscribe: (prepared: T, write: (chunk: string) => void) => () => void): Promise<void> {
  const startedUnder = typeof res.locals.membershipGeneration === 'number' ? res.locals.membershipGeneration as number : generation;
  let closed = false;
  let stop: (() => void) | undefined;
  /** Unsubscribes once, whether the client left or the server ended the stream. */
  const finish = () => {
    open.delete(res);
    const unsubscribe = stop;
    stop = undefined;
    unsubscribe?.();
  };
  res.on('close', () => {
    closed = true;
    finish();
  });
  let prepared: T;
  try {
    prepared = await prepare();
  } catch (error) {
    if (!closed) fail(error);
    return;
  }
  if (closed || res.destroyed) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  // The members changed after this request read them: what `prepare` read may include a repository that left or was
  // hidden, so the page is told to reload and reconnect instead.
  if (generation !== startedUnder) {
    res.end(MEMBERSHIP_EVENT);
    return;
  }
  const unsubscribe = subscribe(prepared, chunk => res.write(chunk));
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
  stop = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  open.add(res);
  // Ending the response unsubscribes at once; its socket may close later.
  res.on('finish', finish);
}
