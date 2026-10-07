import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/** An EventSource the test drives: `end` is the browser giving up after an answer such as 204. */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  constructor(readonly url: string) {
    super();
    FakeEventSource.opened.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  send(type: string, data: string) {
    this.dispatchEvent(Object.assign(new Event(type), { data }));
  }
  end() {
    this.readyState = FakeEventSource.CLOSED;
    this.dispatchEvent(new Event('error'));
  }
}

beforeEach(() => {
  vi.resetModules();
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

it('shares one history stream between panels and closes it with the last', async () => {
  const { onHistoryChanged } = await import('./history-api.js');
  const first = vi.fn(), second = vi.fn();
  const stopFirst = onHistoryChanged(first);
  const stopSecond = onHistoryChanged(second);
  expect(FakeEventSource.opened).toHaveLength(1);
  const [events] = FakeEventSource.opened;
  events.send('history', '{"repositories":["home"]}');
  expect(first).toHaveBeenCalledWith({ repositories: ['home'] });
  expect(second).toHaveBeenCalledWith({ repositories: ['home'] });
  stopFirst();
  expect(events.readyState).toBe(FakeEventSource.CONNECTING);
  stopSecond();
  expect(events.readyState).toBe(FakeEventSource.CLOSED);
});

it('keeps reconnecting through dropped connections', async () => {
  const { onHistoryChanged } = await import('./history-api.js');
  const stop = onHistoryChanged(() => {});
  const [events] = FakeEventSource.opened;
  events.dispatchEvent(new Event('error'));
  stop();
  onHistoryChanged(() => {});
  expect(FakeEventSource.opened).toHaveLength(2);
});

it('stops asking for the stream once the server ends it, as a serverless deployment does', async () => {
  const { onHistoryChanged } = await import('./history-api.js');
  const listener = vi.fn();
  const stop = onHistoryChanged(listener);
  FakeEventSource.opened[0].end();
  stop();
  const stopAgain = onHistoryChanged(listener);
  expect(FakeEventSource.opened).toHaveLength(1);
  stopAgain();
  expect(listener).not.toHaveBeenCalled();
});
