import type { Response } from 'express';

/** Keeps idle event streams open through proxies that close silent connections. */
const HEARTBEAT_MS = 25_000;

/** Every open stream, so a membership change can end them all. */
const open = new Set<Response>();

/**
 * Ends every open event stream. A browser's `EventSource` reconnects on its own, and its new stream subscribes to the
 * workspace as it is now; a membership change ends them so no stream keeps watching a repository that left or was hidden.
 */
export function endEventStreams(): void {
  for (const res of open) res.end();
}

/**
 * Opens a server-sent event stream once `prepare` has read what it needs, and ends its subscription when the client leaves.
 * A client that leaves while `prepare` still runs gets no stream: the close is heard from the start, so nothing subscribes after it.
 * `prepare` failing answers with `fail`; `subscribe` returns its unsubscribe and writes events through `write`.
 */
export async function openEventStream<T>(res: Response, prepare: () => Promise<T>, fail: (error: unknown) => void, subscribe: (prepared: T, write: (chunk: string) => void) => () => void): Promise<void> {
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
