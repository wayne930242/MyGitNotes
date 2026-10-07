import type { Response } from 'express';

/** Keeps idle event streams open through proxies that close silent connections. */
const HEARTBEAT_MS = 25_000;

/**
 * Opens a server-sent event stream once `prepare` has read what it needs, and ends its subscription when the client leaves.
 * A client that leaves while `prepare` still runs gets no stream: the close is heard from the start, so nothing subscribes after it.
 * `prepare` failing answers with `fail`; `subscribe` returns its unsubscribe and writes events through `write`.
 */
export async function openEventStream<T>(res: Response, prepare: () => Promise<T>, fail: (error: unknown) => void, subscribe: (prepared: T, write: (chunk: string) => void) => () => void): Promise<void> {
  let closed = false;
  let stop: (() => void) | undefined;
  res.on('close', () => {
    closed = true;
    stop?.();
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
}
