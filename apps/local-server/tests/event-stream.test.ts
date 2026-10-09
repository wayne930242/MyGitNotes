import { afterEach, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { endEventStreams, membershipGeneration, openEventStream } from '../src/event-stream.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

/** Serves one event stream whose `prepare` waits until the test lets it go, recording each subscription. */
async function serve(recordGeneration: boolean) {
  let release = () => {};
  const prepared = new Promise<void>(resolve => release = resolve);
  let entered = () => {};
  const preparing = new Promise<void>(resolve => entered = resolve);
  const subscribed: string[] = [];
  const app = express();
  app.get('/events', (_req, res) => {
    if (recordGeneration) res.locals.membershipGeneration = membershipGeneration();
    void openEventStream(
      res,
      async () => {
        entered();
        await prepared;
        return 'old members';
      },
      () => res.status(500).end(),
      members => {
        subscribed.push(members);
        return () => {};
      },
    );
  });
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const response = fetch(`http://127.0.0.1:${(server.address() as { port: number; }).port}/events`);
  await preparing;
  return { response, release, subscribed };
}

it('never subscribes a stream whose members changed while it was being prepared, and tells the page to reload', async () => {
  for (const recordGeneration of [true, false]) {
    const { response, release, subscribed } = await serve(recordGeneration);
    endEventStreams();
    release();
    const body = await (await response).text();
    expect(body).toContain('event: change\ndata: {"membership":true}\n\n');
    expect(subscribed).toEqual([]);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }
});

it('subscribes when nothing changed meanwhile', async () => {
  const { response, release, subscribed } = await serve(true);
  release();
  const reader = (await response).body!.getReader();
  await reader.read();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(subscribed).toEqual(['old members']);
  // The change that follows reaches the open stream as an event before it ends.
  endEventStreams();
  let received = '', done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    received += new TextDecoder().decode(chunk.value ?? new Uint8Array());
  }
  expect(received).toContain('event: change\ndata: {"membership":true}\n\n');
});
