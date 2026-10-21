// A LibSQL server for local runs, where no sqld container can be pulled: Node's own SQLite behind Hrana's HTTP
// pipeline endpoint (/v2/pipeline, as Turso and sqld answer it), with /version and the CORS headers a browser needs.
//   node scripts/libsql-stand-in.mjs 18081 [token]
// With a token, requests must carry it as a bearer; the database lives in memory for the run and is seeded with
// scripts/seed-libsql.mjs. CI runs the real sqld container instead.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.argv[2] ?? 18081);
const token = process.argv[3];
const db = new DatabaseSync(':memory:');

const value = (v) => (v === null ? { type: 'null' } : typeof v === 'bigint' ? { type: 'integer', value: v.toString() } : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) : v instanceof Uint8Array ? { type: 'blob', base64: Buffer.from(v).toString('base64') } : { type: 'text', value: String(v) });

function execute(sql) {
  const stmt = db.prepare(sql);
  let cols = [];
  try {
    cols = stmt.columns().map((c) => ({ name: c.name, decltype: c.type }));
  } catch {
    // A statement with no columns.
  }
  if (cols.length) {
    const rows = stmt.all().map((r) => cols.map((c) => value(r[c.name])));
    return { cols, rows, affected_row_count: 0, last_insert_rowid: null };
  }
  const r = stmt.run();
  return { cols: [], rows: [], affected_row_count: Number(r.changes), last_insert_rowid: r.lastInsertRowid === undefined ? null : String(r.lastInsertRowid) };
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' };

createServer((req, res) => {
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
  if (token && req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized: `The JWT is invalid`' }));
  if (req.method === 'GET' && req.url === '/version') return void res.writeHead(200, cors).end('sqld 0.24.0 (stand-in)');
  if (req.method !== 'POST' || !/^\/v[23]\/pipeline$/.test(req.url ?? '')) return void res.writeHead(404, cors).end('not found');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { requests } = JSON.parse(body);
    const results = requests.map((r) => {
      if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
      try {
        return { type: 'ok', response: { type: 'execute', result: execute(r.stmt.sql) } };
      } catch (e) {
        return { type: 'error', error: { message: e.message.replace(/^SQLite error: /i, ''), code: e.code ?? 'SQLITE_ERROR' } };
      }
    });
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ baton: null, base_url: null, results }));
  });
}).listen(port, '127.0.0.1', () => console.log(`LibSQL stand-in on http://127.0.0.1:${port}${token ? ' (token required)' : ''}`));
