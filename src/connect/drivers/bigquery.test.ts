// The BigQuery driver against recorded exchanges in the REST API's shape (tests/fixtures/db/bigquery/, recorded from
// scripts/bigquery-stand-in.mjs with scripts/record-database.mjs bigquery <url>; a real project records the same
// way), and against a project that refuses a part. The key the tests sign with is a throwaway made for the run.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { replayFetch } from '../../../tests/helpers/replayFetch';
import { testServiceAccountKey } from '../../../tests/helpers/testKey';
import { ConnectorError, type ConnectorContext } from '../types';
import { bigqueryConfigFor, bigqueryConnector, bigqueryProblem, optionText, parseKey, readSql, tablesSql, tokenUriAllowed } from './bigquery';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/bigquery/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const connection: Connection = { id: 'c', name: 'shop', driver: 'bigquery', via: 'browser', settings: { project: 'puddle-test', dataset: 'shop', endpoint: 'http://127.0.0.1:18090' }, auth: 'key' };
let ctx: ConnectorContext;
beforeAll(async () => {
  ctx = { connection, secret: await testServiceAccountKey() };
});

describe('the BigQuery driver', () => {
  it('signs in with the key, then tests, catalogues and documents the dataset as recorded', async () => {
    const f = replayFetch('bigquery');
    const c = bigqueryConnector(f);
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
    // One token for the whole run: the exchange is signed once and kept until it expires.
    expect(f.calls.filter((x) => x.url.endsWith('/token'))).toHaveLength(1);
    expect(f.calls.every((x) => !x.body?.includes('BEGIN PRIVATE KEY') && !/assertion=ey/.test(x.body ?? ''))).toBe(true);
  });

  it('reads a table as an Arrow stream, following the job to its end and through its pages, the array and the struct as JSON', async () => {
    const c = bigqueryConnector(replayFetch('bigquery'));
    const r = await c.read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'id', sqlType: 'BIGINT' },
      { name: 'customer_id', sqlType: 'BIGINT' },
      { name: 'total', sqlType: 'DECIMAL(38,9)' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'tags', sqlType: 'JSON' },
      { name: 'shipping', sqlType: 'JSON' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.5', '120', '42.25']);
    expect(t.getChild('tags')!.get(0)).toBe('["gift","express"]');
    expect(t.getChild('shipping')!.get(0)).toBe('{"city":"London","postcode":"N1 9GU"}');
    expect(t.getChild('shipping')!.get(1)).toBeNull();
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query as a subquery, typed from the result', async () => {
    const c = bigqueryConnector(replayFetch('bigquery'));
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(38,9)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('active')!.get(0)).toBe(true);
    expect(Number(t.getChild('signed_up')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('lists every dataset as a schema when the connection names none', async () => {
    const replay = replayFetch('bigquery');
    // The recording was made with the dataset set; this fetch answers the dataset list itself and lends the rest the dataset.
    const f: typeof fetch = (input, init) => {
      if (typeof init?.body === 'string' && init.body.startsWith('{')) {
        const request = JSON.parse(init.body) as { query: string };
        if (/INFORMATION_SCHEMA\.SCHEMATA/.test(request.query)) return Promise.resolve(new Response(JSON.stringify({ jobComplete: true, schema: { fields: [{ name: 'schema_name', type: 'STRING' }] }, rows: [{ f: [{ v: 'shop' }] }] }), { status: 200 }));
        return replay(input, { ...init, body: JSON.stringify({ ...request, defaultDataset: { projectId: 'puddle-test', datasetId: 'shop' } }) });
      }
      return replay(input, init);
    };
    const c = bigqueryConnector(f);
    const whole = { ...ctx, connection: { ...connection, settings: { project: 'puddle-test', endpoint: 'http://127.0.0.1:18090' } } };
    expect(await c.test(whole)).toEqual({ ok: true, server: 'BigQuery project puddle-test, 1 dataset' });
    const catalog = await c.catalog(whole);
    expect(catalog.tables.map((t) => [t.schema, t.name])).toEqual([['shop', 'customers'], ['shop', 'order_totals'], ['shop', 'orders']]);
    const d = await c.document!(whole);
    expect(d.tables.find((t) => t.name === 'orders')!.foreignKeys[0]).toMatchObject({ refSchema: 'shop', refTable: 'customers' });
  });

  it('still documents the tables where a part can’t be read, and says when Google refuses the key', async () => {
    const c = bigqueryConnector(replayFetch('bigquery', { test: (x) => /TABLE_CONSTRAINTS|CONSTRAINT_COLUMN_USAGE/.test(x), status: 403, response: JSON.stringify({ error: { code: 403, message: 'Access Denied', status: 'PERMISSION_DENIED', errors: [{ reason: 'accessDenied' }] } }) }));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['customers', 'order_totals', 'orders']);
    expect(d.tables.every((t) => t.foreignKeys.length === 0 && t.columns.every((x) => !x.pk))).toBe(true);
    expect(d.tables[0]!.note).toBe('People who have ordered');
    const refused = bigqueryConnector(replayFetch('bigquery', { test: (x) => x.includes('/token'), status: 400, response: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) }));
    await expect(refused.test(ctx)).rejects.toThrow('Google refused the service account’s key.');
  });

  it('needs a project and the JSON key, and keeps Google’s address unless the settings name another', async () => {
    expect(() => bigqueryConfigFor({ connection: { ...connection, settings: {} } })).toThrow('Give the project.');
    expect(() => bigqueryConfigFor({ connection: { ...connection, settings: { project: 'p' } } })).toThrow('Paste the service account’s JSON key to sign in.');
    expect(() => bigqueryConfigFor({ connection: { ...connection, settings: { project: 'p' } }, secret: 'not json' })).toThrow('The secret should be the service account’s JSON key file, pasted whole.');
    expect(() => parseKey('{"client_email":"a"}')).toThrow(ConnectorError);
    // A pasted key can't send the service to a token endpoint of its own choosing.
    const elsewhere = JSON.stringify({ ...JSON.parse(ctx.secret!), token_uri: 'https://evil.example/token' });
    expect(() => bigqueryConfigFor({ connection: { ...connection, settings: { project: 'p' } }, secret: elsewhere })).toThrow('The key’s token_uri should be Google’s (oauth2.googleapis.com).');
    expect(tokenUriAllowed('https://oauth2.googleapis.com/token', 'https://bigquery.googleapis.com')).toBe(true);
    expect(tokenUriAllowed('http://oauth2.googleapis.com/token', 'https://bigquery.googleapis.com')).toBe(false);
    const config = bigqueryConfigFor({ connection: { ...connection, settings: { project: 'p', dataset: ' sales ' } }, secret: await testServiceAccountKey('https://oauth2.googleapis.com/token') });
    expect(config).toMatchObject({ endpoint: 'https://bigquery.googleapis.com', project: 'p', dataset: 'sales' });
    expect(config.key?.client_email).toBe('puddle@puddle-test.iam.gserviceaccount.com');
    expect(bigqueryConfigFor(ctx).endpoint).toBe('http://127.0.0.1:18090');
    expect(tablesSql(config, 'sales')).toBe('SELECT table_name, table_type FROM `p.sales`.INFORMATION_SCHEMA.TABLES ORDER BY table_name');
  });

  it('says a failure in plain words', () => {
    const config = bigqueryConfigFor(ctx);
    expect(bigqueryProblem(401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } }, config).message).toBe('Google refused the service account’s key.');
    expect(bigqueryProblem(403, { error: { code: 403, message: 'Access Denied: Project puddle-test: User does not have bigquery.jobs.create permission', errors: [{ reason: 'accessDenied' }] } }, config).message).toBe('The service account may not read puddle-test: Access Denied: Project puddle-test: User does not have bigquery.jobs.create permission');
    expect(bigqueryProblem(404, { error: { code: 404, message: 'Not found: Dataset puddle-test:nothing was not found in location US', errors: [{ reason: 'notFound' }] } }, config).message).toBe('There is no dataset called nothing in puddle-test.');
    expect(bigqueryProblem(400, { error: { code: 400, message: 'Syntax error: Unexpected identifier "SELEC" at [1:1]', errors: [{ reason: 'invalidQuery' }] } }, config).message).toBe('BigQuery answered: Syntax error: Unexpected identifier "SELEC" at [1:1]');
    expect(bigqueryProblem(500, undefined, config).message).toBe('BigQuery answered: status 500');
    expect(optionText('"People who have ordered"')).toBe('People who have ordered');
    expect(optionText('"Say \\"hi\\""')).toBe('Say "hi"');
  });

  it('writes the SQL of a read in GoogleSQL, in the table’s dataset or the connection’s', () => {
    const config = bigqueryConfigFor(ctx);
    expect(readSql(config, { table: { name: 'orders' } })).toBe('SELECT * FROM `puddle-test.shop.orders`');
    expect(readSql(config, { table: { schema: 'sales', name: 'or`ders' }, limit: 5 })).toBe('SELECT * FROM `puddle-test.sales.orders` LIMIT 5');
    expect(readSql(config, { query: 'SELECT 1; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1) AS puddle_query LIMIT 2');
    expect(() => readSql({ ...config, dataset: undefined }, { table: { name: 'orders' } })).toThrow('Give the dataset to read.');
  });
});
