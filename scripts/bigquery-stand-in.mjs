// A stand-in for Google's token endpoint and BigQuery's REST API, serving the shop of tests/fixtures/db/seed-bigquery.sql
// in the shapes the real services answer with, for the driver's live tests and for recording its fixtures where no
// BigQuery project is at hand (CI, and this repository's own fixtures). It checks a sign-in the way Google does as far
// as the driver can tell: the assertion must be a JWT signed RS256 by the given key's private key, naming the
// readonly scope, and every API request must carry the token it was given. It is not BigQuery: a real project is
// the proof, and PUDDLE_TEST_BIGQUERY can name one instead.
//
//   node scripts/bigquery-stand-in.mjs <port> <path to the service account's JSON key>
//
// The key is a throwaway made for the tests (tests/helpers/testKey.ts writes one); the stand-in's token_uri must be
// this server's /token, which the test helper sets.
import { createPublicKey, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 18090);
const key = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const publicKey = createPublicKey(key.private_key);
const PROJECT = 'puddle-test';
const DATASET = 'shop';
const TOKEN = 'stand-in-access-token';

const v = (x) => ({ v: x });
const seconds = (iso) => `${Date.UTC(...iso) / 1000}.0`;
const customers = {
  fields: [
    { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'REQUIRED' },
    { name: 'email', type: 'STRING', mode: 'NULLABLE' },
    { name: 'signed_up', type: 'DATE', mode: 'NULLABLE' },
    { name: 'active', type: 'BOOLEAN', mode: 'NULLABLE' },
  ],
  rows: [
    ['1', 'Ada Lovelace', 'ada@example.com', '2024-01-15', 'true'],
    ['2', 'Grace Hopper', 'grace@example.com', '2024-02-20', 'true'],
    ['3', 'Alan Turing', null, '2024-03-05', 'false'],
  ],
};
const orders = {
  fields: [
    { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'customer_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'total', type: 'NUMERIC', mode: 'NULLABLE' },
    { name: 'placed_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'notes', type: 'STRING', mode: 'NULLABLE' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    { name: 'shipping', type: 'RECORD', mode: 'NULLABLE', fields: [{ name: 'city', type: 'STRING', mode: 'NULLABLE' }, { name: 'postcode', type: 'STRING', mode: 'NULLABLE' }] },
  ],
  rows: [
    ['101', '1', '19.99', seconds([2024, 3, 1, 9, 30]), 'shipped', 'Gift wrap', [v('gift'), v('express')], { f: [v('London'), v('N1 9GU')] }],
    ['102', '1', '5.5', seconds([2024, 3, 2, 14, 0]), 'placed', null, [], null],
    ['103', '2', '120', seconds([2024, 3, 3, 11, 15]), 'returned', null, [v('bulk')], { f: [v('Leeds'), v('LS1 1UR')] }],
    ['104', '3', '42.25', seconds([2024, 3, 4, 16, 45]), 'placed', null, [], null],
  ],
};
const text = (names) => names.map((name) => ({ name, type: 'STRING', mode: 'NULLABLE' }));
const declared = { INTEGER: 'INT64', STRING: 'STRING', NUMERIC: 'NUMERIC', TIMESTAMP: 'TIMESTAMP', DATE: 'DATE', BOOLEAN: 'BOOL' };
const columnRows = (table, t) =>
  t.fields.map((f, i) => [table, f.name, String(i + 1), f.mode === 'REPEATED' ? `ARRAY<${declared[f.type]}>` : f.type === 'RECORD' ? 'STRUCT<city STRING, postcode STRING>' : declared[f.type], f.mode === 'REQUIRED' ? 'NO' : 'YES', f.name === 'status' ? "'placed'" : 'NULL']);
const viewSql = 'SELECT c.name, COUNT(o.id) AS orders, SUM(o.total) AS total FROM `puddle-test.shop.orders` o JOIN `puddle-test.shop.customers` c ON c.id = o.customer_id GROUP BY c.name';

/** The answer to a statement: its schema fields and its rows as plain values, or an error. */
const answer = (sql) => {
  if (/INFORMATION_SCHEMA\.SCHEMATA/.test(sql)) return { fields: text(['schema_name']), rows: [['shop']] };
  if (/COUNT\(\*\) AS n FROM `puddle-test\.shop`\.INFORMATION_SCHEMA\.TABLES/.test(sql)) return { fields: [{ name: 'n', type: 'INTEGER', mode: 'NULLABLE' }], rows: [['3']] };
  if (/INFORMATION_SCHEMA\.TABLES/.test(sql)) return { fields: text(['table_name', 'table_type']), rows: [['customers', 'BASE TABLE'], ['order_totals', 'VIEW'], ['orders', 'BASE TABLE']] };
  if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
    const view = [['order_totals', 'name', '1', 'STRING', 'YES', 'NULL'], ['order_totals', 'orders', '2', 'INT64', 'YES', 'NULL'], ['order_totals', 'total', '3', 'NUMERIC', 'YES', 'NULL']];
    return { fields: [...text(['table_name', 'column_name']), { name: 'ordinal_position', type: 'INTEGER', mode: 'NULLABLE' }, ...text(['data_type', 'is_nullable', 'column_default'])], rows: [...columnRows('customers', customers), ...view, ...columnRows('orders', orders)] };
  }
  if (/INFORMATION_SCHEMA\.COLUMN_FIELD_PATHS/.test(sql)) return { fields: text(['table_name', 'column_name', 'description']), rows: [['customers', 'email', 'Lower case']] };
  if (/INFORMATION_SCHEMA\.TABLE_OPTIONS/.test(sql)) return { fields: text(['table_name', 'option_value']), rows: [['customers', '"People who have ordered"']] };
  if (/__TABLES__/.test(sql)) return { fields: [{ name: 'table_id', type: 'STRING', mode: 'NULLABLE' }, { name: 'row_count', type: 'INTEGER', mode: 'NULLABLE' }], rows: [['customers', '3'], ['orders', '4']] };
  if (/INFORMATION_SCHEMA\.VIEWS/.test(sql)) return { fields: text(['table_name', 'view_definition']), rows: [['order_totals', viewSql]] };
  if (/INFORMATION_SCHEMA\.TABLE_CONSTRAINTS/.test(sql))
    return {
      fields: [...text(['table_name', 'constraint_name', 'constraint_type', 'column_name']), { name: 'ordinal_position', type: 'INTEGER', mode: 'NULLABLE' }],
      rows: [['customers', 'customers.pk$', 'PRIMARY KEY', 'id', '1'], ['orders', 'orders.customer_id', 'FOREIGN KEY', 'customer_id', '1'], ['orders', 'orders.pk$', 'PRIMARY KEY', 'id', '1']],
    };
  if (/INFORMATION_SCHEMA\.CONSTRAINT_COLUMN_USAGE/.test(sql)) return { fields: text(['constraint_name', 'table_name', 'column_name']), rows: [['customers.pk$', 'customers', 'id'], ['orders.customer_id', 'customers', 'id'], ['orders.pk$', 'orders', 'id']] };
  if (/^SELECT \* FROM `puddle-test\.shop\.orders`( LIMIT \d+)?$/.test(sql)) return { ...orders, slow: true };
  if (/^SELECT \* FROM `puddle-test\.shop\.customers`( LIMIT \d+)?$/.test(sql)) return customers;
  if (/SELECT c\.name, o\.total, o\.placed_at, o\.status, c\.signed_up, c\.active FROM orders o JOIN customers c ON c\.id = o\.customer_id ORDER BY o\.id\) AS puddle_query LIMIT 2$/.test(sql))
    return { fields: [customers.fields[1], orders.fields[2], orders.fields[3], orders.fields[4], customers.fields[3], customers.fields[4]], rows: [['Ada Lovelace', '19.99', seconds([2024, 3, 1, 9, 30]), 'shipped', '2024-01-15', 'true'], ['Ada Lovelace', '5.5', seconds([2024, 3, 2, 14, 0]), 'placed', '2024-01-15', 'true']] };
  if (/SELECT name, signed_up, active FROM customers ORDER BY id\) AS puddle_query LIMIT 2$/.test(sql)) return { fields: [customers.fields[1], customers.fields[3], customers.fields[4]], rows: customers.rows.slice(0, 2).map((r) => [r[1], r[3], r[4]]) };
  if (/^\s*(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE)\b/i.test(sql))
    return { error: { code: 403, message: `Access Denied: Table puddle-test:shop.orders: User does not have permission to write to table puddle-test:shop.orders.`, status: 'PERMISSION_DENIED', errors: [{ reason: 'accessDenied', message: 'Access Denied' }] } };
  return { error: { code: 400, message: `Syntax error: Unexpected identifier "${sql.slice(0, 5)}" at [1:1]`, status: 'INVALID_ARGUMENT', errors: [{ reason: 'invalidQuery', message: 'Syntax error' }] } };
};

const wrap = (a) => ({ schema: { fields: a.fields }, rows: a.rows.map((r) => ({ f: r.map((x) => ({ v: x })) })), totalRows: String(a.rows.length) });

/** A JWT's signature checked against the key, and its claims returned; nothing when it doesn't hold. */
const verify = (jwt) => {
  const parts = jwt.split('.');
  if (parts.length !== 3) return undefined;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(publicKey, Buffer.from(parts[2], 'base64url'))) return undefined;
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
};

const jobs = new Map();
let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'POST' && url.pathname === '/token') {
      const form = new URLSearchParams(body);
      const claims = form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' ? verify(form.get('assertion') ?? '') : undefined;
      if (!claims || claims.iss !== key.client_email || claims.scope !== 'https://www.googleapis.com/auth/bigquery.readonly' || claims.aud !== key.token_uri) return send(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
      return send(200, { access_token: TOKEN, expires_in: 3599, token_type: 'Bearer' });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
    const m = /^\/bigquery\/v2\/projects\/([^/]+)\/queries(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return send(404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
    if (decodeURIComponent(m[1]) !== PROJECT) return send(403, { error: { code: 403, message: `Access Denied: Project ${decodeURIComponent(m[1])}: User does not have bigquery.jobs.create permission in project ${decodeURIComponent(m[1])}.`, status: 'PERMISSION_DENIED', errors: [{ reason: 'accessDenied', message: 'Access Denied' }] } });
    if (req.method === 'POST' && !m[2]) {
      const request = JSON.parse(body);
      if (request.useLegacySql !== false) return send(400, { error: { code: 400, message: 'Legacy SQL is not served here', status: 'INVALID_ARGUMENT', errors: [{ reason: 'invalidQuery', message: 'Legacy SQL' }] } });
      const sql = request.query;
      const dataset = /`puddle-test\.([^.`]+)/.exec(sql)?.[1];
      if (dataset && dataset !== DATASET) return send(404, { error: { code: 404, message: `Not found: Dataset puddle-test:${dataset} was not found in location US`, status: 'NOT_FOUND', errors: [{ reason: 'notFound', message: 'Not found' }] } });
      const a = answer(sql);
      if (a.error) return send(a.error.code, { error: a.error });
      const jobId = `job_${++n}`;
      const jobReference = { projectId: PROJECT, jobId, location: 'US' };
      if (a.slow) {
        // A read of the orders takes longer than the request waits: it comes back unfinished, then page by page.
        jobs.set(jobId, { ...wrap(a), pages: 2 });
        return send(200, { kind: 'bigquery#queryResponse', jobReference, jobComplete: false });
      }
      return send(200, { kind: 'bigquery#queryResponse', jobReference, jobComplete: true, ...wrap(a) });
    }
    if (req.method === 'GET' && m[2]) {
      const job = jobs.get(decodeURIComponent(m[2]));
      if (!job) return send(404, { error: { code: 404, message: `Not found: Job ${m[2]}`, status: 'NOT_FOUND', errors: [{ reason: 'notFound', message: 'Not found' }] } });
      const jobReference = { projectId: PROJECT, jobId: decodeURIComponent(m[2]), location: 'US' };
      const token = url.searchParams.get('pageToken');
      const half = Math.ceil(job.rows.length / 2);
      if (!token) return send(200, { kind: 'bigquery#getQueryResultsResponse', jobReference, jobComplete: true, schema: job.schema, totalRows: job.totalRows, rows: job.rows.slice(0, half), pageToken: 'page2' });
      return send(200, { kind: 'bigquery#getQueryResultsResponse', jobReference, jobComplete: true, schema: job.schema, totalRows: job.totalRows, rows: job.rows.slice(half) });
    }
    send(405, { error: { code: 405, message: 'Method not allowed', status: 'FAILED_PRECONDITION' } });
  });
}).listen(port, '127.0.0.1', () => console.log(`BigQuery stand-in for project ${PROJECT}, dataset ${DATASET}, on http://127.0.0.1:${port}`));
