import { createClient } from 'redis';

type Connection = { client: ReturnType<typeof createClient>; ready: Promise<unknown>; };
const connections = new Map<string, Connection>();

/** Reuse one native connection per endpoint; a later request reconnects after failure. */
export async function nativeRedisCommand(url: string, command: string[]): Promise<any> {
  if (!/^rediss?:\/\//.test(url)) throw new Error('REDIS_URL must use redis:// or rediss://.');
  let connection = connections.get(url);
  try {
    if (!connection?.client.isOpen) {
      const client = createClient({ url, socket: { connectTimeout: 10000, reconnectStrategy: false }, commandOptions: { timeout: 10000 }, disableOfflineQueue: true });
      client.on('error', () => console.warn('[session-store] Redis connection unavailable.'));
      connection = { client, ready: client.connect().then(() => client.unref()) };
      connections.set(url, connection);
    }
    await connection.ready;
    return await connection.client.sendCommand(command);
  } catch {
    if (connections.get(url) === connection) connections.delete(url);
    if (connection?.client.isOpen) connection.client.destroy();
    throw new Error('Session store unavailable.');
  }
}
