// A stand-in for Snowflake's SQL REST API, serving the shop of tests/fixtures/db/seed-snowflake.sql in the shapes the
// real API answers with (jsonv2: every value as text, dates as days, timestamps as seconds.nanoseconds), for the
// driver's live tests and for recording its fixtures where no account is at hand (CI, and this repository's own
// fixtures). It checks a sign-in the way Snowflake does as far as the driver can tell: a KEYPAIR_JWT bearer token
// signed RS256 by the given key, whose issuer names the account, the user and the public key's SHA-256
// fingerprint. The read of the orders comes back unfinished first and then in two partitions, so the driver's
// polling and partition reads are exercised. It is not Snowflake: a real account is the proof, and
// PUDDLE_TEST_SNOWFLAKE can name one instead.
//
//   node scripts/snowflake-stand-in.mjs <port> <path to the private key, PKCS#8 PEM>
import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 18091);
const publicKey = createPublicKey(readFileSync(process.argv[3], 'utf8'));
const fingerprint = `SHA256:${createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('base64')}`;
const ACCOUNT = 'XY12345';
const USER = 'PUDDLE';
const DATABASE = 'SHOP';
const SCHEMA = 'PUBLIC';

const col = (name, type, extra = {}) => ({ name, database: DATABASE, schema: SCHEMA, table: '', nullable: true, byteLength: null, length: null, scale: null, precision: null, collation: null, type, ...extra });
const text = (name, length = 16777216) => col(name, 'text', { length, byteLength: length * 4 });
const fixed = (name, precision = 38, scale = 0) => col(name, 'fixed', { precision, scale });
const days = (y, m, d) => String(Date.UTC(y, m - 1, d) / 86_400_000);
const stamp = (y, m, d, h, min) => `${Date.UTC(y, m - 1, d, h, min) / 1000}.000000000`;

const customers = {
  rowType: [fixed('ID', 10, 0), text('NAME', 100), text('EMAIL', 255), col('SIGNED_UP', 'date'), col('ACTIVE', 'boolean')],
  data: [
    ['1', 'Ada Lovelace', 'ada@example.com', days(2024, 1, 15), 'true'],
    ['2', 'Grace Hopper', 'grace@example.com', days(2024, 2, 20), 'true'],
    ['3', 'Alan Turing', null, days(2024, 3, 5), 'false'],
  ],
};
const orders = {
  rowType: [fixed('ID', 10, 0), fixed('CUSTOMER_ID', 10, 0), fixed('TOTAL', 10, 2), col('PLACED_AT', 'timestamp_ntz', { scale: 9 }), col('DELIVERED_AT', 'timestamp_tz', { scale: 9 }), text('STATUS', 10), text('NOTES'), col('TAGS', 'array'), col('SHIPPING', 'object')],
  data: [
    ['101', '1', '19.99', stamp(2024, 4, 1, 9, 30), `${stamp(2024, 4, 2, 8, 0)} 1500`, 'shipped', 'Gift wrap', '[\n  "gift",\n  "express"\n]', '{\n  "city": "London",\n  "postcode": "N1 9GU"\n}'],
    ['102', '1', '5.50', stamp(2024, 4, 2, 14, 0), null, 'placed', null, '[]', null],
    ['103', '2', '120.00', stamp(2024, 4, 3, 11, 15), null, 'returned', null, '[\n  "bulk"\n]', '{\n  "city": "Leeds",\n  "postcode": "LS1 1UR"\n}'],
    ['104', '3', '42.25', stamp(2024, 4, 4, 16, 45), null, 'placed', null, '[]', null],
  ],
};
const viewSql = 'CREATE OR REPLACE VIEW ORDER_TOTALS AS SELECT c.name, COUNT(o.id) AS orders, SUM(o.total) AS total FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY c.name';
const columnRow = (table, name, position, type, length, precision, scale, nullable, dflt, identity, comment) => [SCHEMA, table, name, String(position), type, length, precision, scale, nullable, dflt, identity, comment];
const columns = [
  columnRow('CUSTOMERS', 'ID', 1, 'NUMBER', null, '10', '0', 'NO', null, 'NO', null),
  columnRow('CUSTOMERS', 'NAME', 2, 'TEXT', '100', null, null, 'NO', null, 'NO', null),
  columnRow('CUSTOMERS', 'EMAIL', 3, 'TEXT', '255', null, null, 'YES', null, 'NO', 'Lower case'),
  columnRow('CUSTOMERS', 'SIGNED_UP', 4, 'DATE', null, null, null, 'YES', null, 'NO', null),
  columnRow('CUSTOMERS', 'ACTIVE', 5, 'BOOLEAN', null, null, null, 'YES', null, 'NO', null),
  columnRow('ORDERS', 'ID', 1, 'NUMBER', null, '10', '0', 'NO', null, 'YES', null),
  columnRow('ORDERS', 'CUSTOMER_ID', 2, 'NUMBER', null, '10', '0', 'NO', null, 'NO', null),
  columnRow('ORDERS', 'TOTAL', 3, 'NUMBER', null, '10', '2', 'YES', null, 'NO', null),
  columnRow('ORDERS', 'PLACED_AT', 4, 'TIMESTAMP_NTZ', null, null, null, 'YES', null, 'NO', null),
  columnRow('ORDERS', 'DELIVERED_AT', 5, 'TIMESTAMP_TZ', null, null, null, 'YES', null, 'NO', null),
  columnRow('ORDERS', 'STATUS', 6, 'TEXT', '10', null, null, 'YES', "'placed'", 'NO', null),
  columnRow('ORDERS', 'NOTES', 7, 'TEXT', '16777216', null, null, 'YES', null, 'NO', null),
  columnRow('ORDERS', 'TAGS', 8, 'ARRAY', null, null, null, 'YES', null, 'NO', null),
  columnRow('ORDERS', 'SHIPPING', 9, 'OBJECT', null, null, null, 'YES', null, 'NO', null),
  columnRow('ORDER_TOTALS', 'NAME', 1, 'TEXT', '100', null, null, 'YES', null, 'NO', null),
  columnRow('ORDER_TOTALS', 'ORDERS', 2, 'NUMBER', null, '18', '0', 'YES', null, 'NO', null),
  columnRow('ORDER_TOTALS', 'TOTAL', 3, 'NUMBER', null, '22', '2', 'YES', null, 'NO', null),
];
const keyCols = (names) => names.map((n) => text(n));
const now = '2024-04-01 00:00:00.000 -0700';

/** The answer to a statement: its rowType and data, with `slow` for one that comes back unfinished and in partitions. */
const answer = (sql) => {
  if (/CURRENT_VERSION\(\)/i.test(sql)) return { rowType: [text('VERSION')], data: [['9.31.2']] };
  if (/COUNT\(\*\) AS n FROM "SHOP"\.INFORMATION_SCHEMA\.TABLES/.test(sql)) return { rowType: [fixed('N', 18, 0)], data: [['3']] };
  if (/"SHOP"\.INFORMATION_SCHEMA\.TABLES/.test(sql)) return { rowType: [text('TABLE_SCHEMA'), text('TABLE_NAME'), text('TABLE_TYPE'), fixed('ROW_COUNT', 38, 0), text('COMMENT')], data: [[SCHEMA, 'CUSTOMERS', 'BASE TABLE', '3', 'People who have ordered'], [SCHEMA, 'ORDERS', 'BASE TABLE', '4', null], [SCHEMA, 'ORDER_TOTALS', 'VIEW', null, null]] };
  if (/"SHOP"\.INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return { rowType: [text('TABLE_SCHEMA'), text('TABLE_NAME'), text('COLUMN_NAME'), fixed('ORDINAL_POSITION', 38, 0), text('DATA_TYPE'), fixed('CHARACTER_MAXIMUM_LENGTH', 38, 0), fixed('NUMERIC_PRECISION', 38, 0), fixed('NUMERIC_SCALE', 38, 0), text('IS_NULLABLE'), text('COLUMN_DEFAULT'), text('IS_IDENTITY'), text('COMMENT')], data: columns };
  if (/"SHOP"\.INFORMATION_SCHEMA\.VIEWS/.test(sql)) return { rowType: [text('TABLE_SCHEMA'), text('TABLE_NAME'), text('VIEW_DEFINITION')], data: [[SCHEMA, 'ORDER_TOTALS', viewSql]] };
  if (/^SHOW PRIMARY KEYS/.test(sql)) return { rowType: keyCols(['created_on', 'database_name', 'schema_name', 'table_name', 'column_name', 'key_sequence', 'constraint_name', 'rely', 'comment']), data: [[now, DATABASE, SCHEMA, 'CUSTOMERS', 'ID', '1', 'SYS_CONSTRAINT_1', 'false', null], [now, DATABASE, SCHEMA, 'ORDERS', 'ID', '1', 'SYS_CONSTRAINT_2', 'false', null]] };
  if (/^SHOW UNIQUE KEYS/.test(sql)) return { rowType: keyCols(['created_on', 'database_name', 'schema_name', 'table_name', 'column_name', 'key_sequence', 'constraint_name', 'rely', 'comment']), data: [[now, DATABASE, SCHEMA, 'CUSTOMERS', 'EMAIL', '1', 'CUSTOMERS_EMAIL_KEY', 'false', null]] };
  if (/^SHOW IMPORTED KEYS/.test(sql))
    return {
      rowType: keyCols(['created_on', 'pk_database_name', 'pk_schema_name', 'pk_table_name', 'pk_column_name', 'fk_database_name', 'fk_schema_name', 'fk_table_name', 'fk_column_name', 'key_sequence', 'update_rule', 'delete_rule', 'fk_name', 'pk_name', 'deferrability', 'rely', 'comment']),
      data: [[now, DATABASE, SCHEMA, 'CUSTOMERS', 'ID', DATABASE, SCHEMA, 'ORDERS', 'CUSTOMER_ID', '1', 'NO ACTION', 'NO ACTION', 'ORDERS_CUSTOMER_ID_FKEY', 'SYS_CONSTRAINT_1', 'NOT DEFERRABLE', 'false', null]],
    };
  if (/^SELECT \* FROM "SHOP"\."PUBLIC"\."ORDERS"( LIMIT \d+)?$/.test(sql)) return { ...orders, slow: true };
  if (/^SELECT \* FROM "SHOP"\."PUBLIC"\."CUSTOMERS"( LIMIT \d+)?$/.test(sql)) return customers;
  if (/SELECT c\.name, o\.total, o\.placed_at, o\.status, c\.signed_up, c\.active FROM orders o JOIN customers c ON c\.id = o\.customer_id ORDER BY o\.id\) AS puddle_query LIMIT 2$/.test(sql))
    return { rowType: [customers.rowType[1], orders.rowType[2], orders.rowType[3], orders.rowType[5], customers.rowType[3], customers.rowType[4]], data: [['Ada Lovelace', '19.99', stamp(2024, 4, 1, 9, 30), 'shipped', days(2024, 1, 15), 'true'], ['Ada Lovelace', '5.50', stamp(2024, 4, 2, 14, 0), 'placed', days(2024, 1, 15), 'true']] };
  if (/SELECT name, signed_up, active FROM customers ORDER BY id\) AS puddle_query LIMIT 2$/.test(sql)) return { rowType: [customers.rowType[1], customers.rowType[3], customers.rowType[4]], data: customers.data.slice(0, 2).map((r) => [r[1], r[3], r[4]]) };
  if (/^\s*(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE)\b/i.test(sql)) return { error: { status: 422, code: '003001', message: `SQL access control error:\nInsufficient privileges to operate on table 'ORDERS'`, sqlState: '42501' } };
  return { error: { status: 422, code: '001003', message: `SQL compilation error:\nsyntax error line 1 at position 0 unexpected '${sql.slice(0, 5)}'.`, sqlState: '42000' } };
};

/** The bearer token checked as Snowflake checks a KEYPAIR_JWT: signed by the key, for this account and user. */
const signedIn = (req) => {
  if (req.headers['x-snowflake-authorization-token-type'] !== 'KEYPAIR_JWT') return false;
  const jwt = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  const parts = jwt?.split('.') ?? [];
  if (parts.length !== 3) return false;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(publicKey, Buffer.from(parts[2], 'base64url'))) return false;
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return claims.iss === `${ACCOUNT}.${USER}.${fingerprint}` && claims.sub === `${ACCOUNT}.${USER}` && claims.exp > Date.now() / 1000;
};

const meta = (a, handle, partitions = [a.data.length]) => ({ numRows: a.data.length, format: 'jsonv2', rowType: a.rowType, partitionInfo: partitions.map((rowCount) => ({ rowCount, uncompressedSize: rowCount * 100 })) });
const pending = new Map();
let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith('/api/v2/statements')) return send(404, { code: '390404', message: 'Not found' });
    if (!signedIn(req)) return send(401, { code: '390144', message: 'JWT token is invalid.' });
    if (req.method === 'POST' && url.pathname === '/api/v2/statements') {
      const request = JSON.parse(body);
      if (request.database && request.database !== DATABASE) return send(422, { code: '002003', message: `SQL compilation error:\nDatabase '${request.database}' does not exist or not authorized.`, sqlState: '02000' });
      if (!request.warehouse) return send(422, { code: '000606', message: 'No active warehouse selected in the current session.  Select an active warehouse with the \'use warehouse\' command.', sqlState: '57P03' });
      const a = answer(request.statement);
      if (a.error) return send(a.error.status, { ...a.error, status: undefined, statementHandle: `01b${++n}` });
      const handle = `01b${++n}-0000-0000-0000-000000000000`;
      if (a.slow) {
        pending.set(handle, a);
        return send(202, { code: '333334', message: 'Asynchronous execution in progress. Use provided query id to perform query monitoring and management.', statementHandle: handle, statementStatusUrl: `/api/v2/statements/${handle}` });
      }
      return send(200, { resultSetMetaData: meta(a, handle), data: a.data, code: '090001', statementStatusUrl: `/api/v2/statements/${handle}`, statementHandle: handle, message: 'Statement executed successfully.', createdOn: Date.now() });
    }
    const m = /^\/api\/v2\/statements\/([^/]+)(\/cancel)?$/.exec(url.pathname);
    if (!m) return send(404, { code: '390404', message: 'Not found' });
    const a = pending.get(m[1]);
    if (!a) return send(422, { code: '002000', message: 'Statement not found', sqlState: '02000' });
    if (m[2] && req.method === 'POST') return send(200, { code: '000000', message: 'Statement cancelled.', statementHandle: m[1] });
    const half = Math.ceil(a.data.length / 2);
    const partition = Number(url.searchParams.get('partition') ?? 0);
    const partitions = [half, a.data.length - half];
    if (partition === 0) return send(200, { resultSetMetaData: meta(a, m[1], partitions), data: a.data.slice(0, half), code: '090001', statementHandle: m[1], message: 'Statement executed successfully.' });
    return send(200, { resultSetMetaData: meta(a, m[1], partitions), data: a.data.slice(half), code: '090001', statementHandle: m[1], message: 'Statement executed successfully.' });
  });
}).listen(port, '127.0.0.1', () => console.log(`Snowflake stand-in for ${ACCOUNT}.${USER} (key ${fingerprint}), database ${DATABASE}, on http://127.0.0.1:${port}`));
