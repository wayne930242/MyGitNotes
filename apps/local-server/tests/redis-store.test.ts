import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('redis', () => ({ createClient: mock.createClient }));
import { nativeRedisCommand } from '../src/redis-store.js';
import { SessionStore } from '../src/auth.js';

function client() {
  const instance = {
    isOpen: false,
    on: vi.fn(),
    connect: vi.fn(async () => {
      instance.isOpen = true;
    }),
    unref: vi.fn(),
    sendCommand: vi.fn(async (_command: string[]): Promise<any> => 'OK'),
    destroy: vi.fn(() => {
      instance.isOpen = false;
    }),
  };
  return instance;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('shares the native connection across stores and prefers it over REST credentials', async () => {
  const redis = client();
  mock.createClient.mockReturnValue(redis);
  vi.stubEnv('REDIS_URL', 'redis://compose-test:6379');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://unused.example.test');
  vi.stubEnv('SESSION_SECRET', 'test-secret'.repeat(5));
  const first = new SessionStore('/unused'), second = new SessionStore('/unused');
  await Promise.all([first.set('a'.repeat(43), { kind: 'session' }), second.set('b'.repeat(43), { kind: 'agent' }, null)]);
  expect(mock.createClient).toHaveBeenCalledTimes(1);
  expect(redis.sendCommand.mock.calls[0][0]).toEqual(expect.arrayContaining(['EX', '2592000']));
  expect(redis.sendCommand.mock.calls[1][0]).toHaveLength(3);
  expect(redis.sendCommand.mock.calls.every(([command]) => !command[2].includes('kind'))).toBe(true);
});

it('reports failures without credentials or a filesystem fallback and reconnects on the next request', async () => {
  const broken = client(), recovered = client();
  broken.sendCommand.mockRejectedValue(new Error('redis://user:private-password@unavailable'));
  mock.createClient.mockReturnValueOnce(broken).mockReturnValueOnce(recovered);
  vi.stubEnv('REDIS_URL', 'rediss://failure-test:6379');
  const store = new SessionStore('/unused');
  await expect(store.command(['PING'])).rejects.toThrow(/^Session store unavailable\.$/);
  expect(broken.destroy).toHaveBeenCalledOnce();
  await expect(store.command(['PING'])).resolves.toBe('OK');
  expect(mock.createClient).toHaveBeenCalledTimes(2);
});

it('rejects unsupported native Redis URL schemes', async () => {
  await expect(nativeRedisCommand('https://wrong.example', ['PING'])).rejects.toThrow('REDIS_URL must use redis:// or rediss://.');
  expect(mock.createClient).not.toHaveBeenCalled();
});

it('keeps malformed URL details out of errors returned to the caller', async () => {
  mock.createClient.mockImplementationOnce(() => {
    throw new Error('Invalid URL redis://user:private-password@');
  });
  await expect(nativeRedisCommand('redis://user:private-password@', ['PING'])).rejects.toThrow(/^Session store unavailable\.$/);
});
