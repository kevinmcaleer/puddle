// A stand-in for Upstash's REST interface in front of any Redis, for the browser flow and the REST tests:
//   node scripts/upstash-stand-in.mjs 18079 puddle-token redis://:password@127.0.0.1:6379/0
// It answers as Upstash does: POST / with a command as a JSON array gives {"result": …} (or {"error": …} with
// status 400), POST /pipeline with an array of commands gives one of those per command, a wrong or missing bearer
// token gives 401, and the CORS headers let a page in. Each command is run on the Redis with node-redis.
import { createServer } from 'node:http';
import { createClient } from 'redis';

const [port, token, url] = process.argv.slice(2);
if (!port || !token || !url) {
  console.error('Usage: node scripts/upstash-stand-in.mjs <port> <token> <redis-url>');
  process.exit(2);
}
const client = createClient({ url, socket: { reconnectStrategy: (n) => Math.min(1000 * n, 5000) } });
client.on('error', (e) => console.error(`redis: ${e.message}`));
await client.connect();

const run = async (command) => {
  if (!Array.isArray(command) || !command.length) return { error: 'ERR a command is a non-empty array' };
  try {
    return { result: await client.sendCommand(command.map(String)) };
  } catch (e) {
    return { error: e.message };
  }
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Max-Age': '600' };
const send = (res, status, body) => {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    send(res, 401, { error: 'Unauthorized' });
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    send(res, 400, { error: 'ERR the body is not JSON' });
    return;
  }
  const path = new URL(req.url, 'http://x').pathname;
  if (req.method === 'POST' && path === '/pipeline') {
    const answers = [];
    for (const command of Array.isArray(body) ? body : []) answers.push(await run(command));
    send(res, 200, answers);
  } else if (req.method === 'POST' && path === '/') {
    const answer = await run(body);
    send(res, 'error' in answer ? 400 : 200, answer);
  } else send(res, 404, { error: 'ERR no such route' });
}).listen(Number(port), '127.0.0.1', () => console.log(`Upstash stand-in on http://127.0.0.1:${port} for ${new URL(url).host}`));
