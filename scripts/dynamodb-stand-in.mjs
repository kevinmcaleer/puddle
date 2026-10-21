// A DynamoDB for local runs, where DynamoDB Local can't be downloaded: tables in memory behind the JSON API's
// shapes (ListTables, DescribeTable, CreateTable, DeleteTable, PutItem, Scan, ExecuteStatement for a SELECT), each
// request's Signature V4 checked against the key it was started with, and the CORS headers a browser needs.
//   node scripts/dynamodb-stand-in.mjs 18092 AKIDEXAMPLE secretexample
// CI runs DynamoDB Local instead (which checks no signatures); the stand-in is seeded with scripts/seed-dynamodb.mjs.
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const [port = '18092', accessKeyId = 'AKIDEXAMPLE', secretAccessKey = 'secretexample'] = process.argv.slice(2);
const tables = new Map();

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s).digest();

/** The signature the request should carry, from its own signed headers and the key the stand-in knows. */
function expectedSignature(req, body) {
  const auth = req.headers.authorization ?? '';
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return { problem: 'IncompleteSignatureException' };
  const [, key, day, region, service, signed, signature] = m;
  if (key !== accessKeyId) return { problem: 'UnrecognizedClientException' };
  const names = signed.split(';');
  const canonical = ['POST', '/', '', ...names.map((n) => `${n}:${String(req.headers[n] ?? '').trim().replace(/\s+/g, ' ')}`), '', signed, sha256(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], scope, sha256(canonical)].join('\n');
  let k = `AWS4${secretAccessKey}`;
  for (const part of [day, region, service, 'aws4_request']) k = hmac(k, part);
  const expected = createHmac('sha256', k).update(toSign).digest('hex');
  return expected === signature ? {} : { problem: 'InvalidSignatureException' };
}

const error = (type, message) => ({ status: 400, body: { __type: `com.amazonaws.dynamodb.v20120810#${type}`, message } });
const num = (s) => Number(s);

/** PartiQL, as far as a SELECT over one table with simple equalities goes. */
function execute(statement) {
  const m = /^\s*SELECT\s+\*\s+FROM\s+"?([^"\s]+)"?(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+))?\s*;?\s*$/is.exec(statement);
  if (!m) return error('ValidationException', 'Statement wasn’t well formed, can’t parse: the stand-in reads SELECT * FROM "table" [WHERE a = v [AND ...]] [ORDER BY k]');
  const t = tables.get(m[1]);
  if (!t) return error('ResourceNotFoundException', 'Requested resource not found');
  let items = [...t.items];
  if (m[2]) {
    for (const cond of m[2].split(/\s+AND\s+/i)) {
      const c = /^"?(\w+)"?\s*(=|>|<|>=|<=)\s*('(?:[^']|'')*'|-?\d+(?:\.\d+)?|true|false)$/i.exec(cond.trim());
      if (!c) return error('ValidationException', `Statement wasn’t well formed, can’t parse: ${cond}`);
      const want = c[3].startsWith("'") ? { S: c[3].slice(1, -1).replaceAll("''", "'") } : /^(true|false)$/i.test(c[3]) ? { BOOL: c[3].toLowerCase() === 'true' } : { N: c[3] };
      const cmp = (a, b) => (c[2] === '=' ? a === b : c[2] === '>' ? a > b : c[2] === '<' ? a < b : c[2] === '>=' ? a >= b : a <= b);
      items = items.filter((it) => {
        const v = it[c[1]];
        if (!v) return false;
        if ('S' in want) return 'S' in v && cmp(v.S, want.S);
        if ('BOOL' in want) return 'BOOL' in v && v.BOOL === want.BOOL;
        return 'N' in v && cmp(num(v.N), num(want.N));
      });
    }
  }
  if (m[3]) items.sort((a, b) => (num(a[m[3]]?.N ?? 0) > num(b[m[3]]?.N ?? 0) ? 1 : -1));
  return { items };
}

function handle(target, body) {
  switch (target) {
    case 'ListTables':
      return { body: { TableNames: [...tables.keys()].sort() } };
    case 'CreateTable': {
      if (tables.has(body.TableName)) return error('ResourceInUseException', 'Table already exists');
      tables.set(body.TableName, { description: { TableName: body.TableName, KeySchema: body.KeySchema, AttributeDefinitions: body.AttributeDefinitions, GlobalSecondaryIndexes: body.GlobalSecondaryIndexes, TableStatus: 'ACTIVE' }, items: [] });
      return { body: { TableDescription: tables.get(body.TableName).description } };
    }
    case 'DeleteTable': {
      if (!tables.has(body.TableName)) return error('ResourceNotFoundException', 'Requested resource not found');
      tables.delete(body.TableName);
      return { body: {} };
    }
    case 'DescribeTable': {
      const t = tables.get(body.TableName);
      if (!t) return error('ResourceNotFoundException', `Requested resource not found: Table: ${body.TableName} not found`);
      return { body: { Table: { ...t.description, ItemCount: t.items.length } } };
    }
    case 'PutItem': {
      const t = tables.get(body.TableName);
      if (!t) return error('ResourceNotFoundException', 'Requested resource not found');
      const keys = t.description.KeySchema.map((k) => k.AttributeName);
      const same = (a, b) => keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
      t.items = [...t.items.filter((it) => !same(it, body.Item)), body.Item];
      return { body: {} };
    }
    case 'Scan': {
      const t = tables.get(body.TableName);
      if (!t) return error('ResourceNotFoundException', 'Requested resource not found');
      const from = body.ExclusiveStartKey ? Number(body.ExclusiveStartKey.__page.N) : 0;
      const limit = body.Limit ?? t.items.length;
      const page = t.items.slice(from, from + limit);
      const more = from + page.length < t.items.length;
      return { body: { Items: page, Count: page.length, ScannedCount: page.length, ...(more ? { LastEvaluatedKey: { __page: { N: String(from + page.length) } } } : {}) } };
    }
    case 'ExecuteStatement': {
      const r = execute(body.Statement);
      if (r.status) return r;
      const from = body.NextToken ? Number(body.NextToken) : 0;
      const limit = body.Limit ?? r.items.length;
      const page = r.items.slice(from, from + limit);
      return { body: { Items: page, ...(from + page.length < r.items.length ? { NextToken: String(from + page.length) } : {}) } };
    }
    default:
      return error('UnknownOperationException', `Unknown operation ${target}`);
  }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, x-amz-target, x-amz-date, x-amz-content-sha256, x-amz-security-token, x-amz-user-agent, amz-sdk-invocation-id, amz-sdk-request' };

createServer((req, res) => {
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const sig = expectedSignature(req, body);
    const out = sig.problem ? { status: 400, body: { __type: `com.amazonaws.dynamodb.v20120810#${sig.problem}`, message: 'The security token included in the request is invalid.' } } : handle(String(req.headers['x-amz-target'] ?? '').replace(/^DynamoDB_20120810\./, ''), body ? JSON.parse(body) : {});
    res.writeHead(out.status ?? 200, { ...cors, 'Content-Type': 'application/x-amz-json-1.0' }).end(JSON.stringify(out.body));
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`DynamoDB stand-in on http://127.0.0.1:${port} for access key ${accessKeyId}`));
