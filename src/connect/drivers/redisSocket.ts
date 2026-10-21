// The socket client for Redis (node-redis), for puddle-connect and the runner only: the browser reads a Redis over
// Upstash's REST interface, so this module stays out of the page's bundle.
import type { RedisConnect, RedisReply } from './redis';

export const redisConnect: RedisConnect = async (config) => {
  const { createClient } = await import('redis');
  const client = createClient({
    socket: { host: config.host ?? '127.0.0.1', port: config.port, connectTimeout: 10_000, reconnectStrategy: false, ...(config.ssl ? { tls: true as const } : {}) },
    ...(config.user ? { username: config.user } : {}),
    ...(config.password ? { password: config.password } : {}),
    database: config.db,
  });
  client.on('error', () => undefined);
  await client.connect();
  const send = (args: string[]) => client.sendCommand(args) as Promise<RedisReply>;
  return {
    send,
    sendAll: (commands) => Promise.all(commands.map(send)),
    end: async () => {
      try {
        await client.close();
      } catch {
        client.destroy();
      }
    },
  };
};
