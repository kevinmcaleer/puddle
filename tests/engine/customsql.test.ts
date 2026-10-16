// The custom SQL step on real DuckDB-WASM (Node build) against tests/fixtures/orders.tsv, with customers.csv
// registered too as the other source a step must not be able to read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TokenType } from '@duckdb/duckdb-wasm/blocking';
import { compile, CompileError, compileDisplayPage, customSqlErrorLine, customSqlProblem, lexSql, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { toEngineError } from '../../src/engine/errors';
import type { Step } from '../../src/model';
import { ACCEPTED, REFUSED } from '../helpers/customSqlCorpus';
import { createNodeBackend, createNodeTokenizer } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const orders = src({ id: 'orders', format: 'tsv' });
const customers = src({ id: 'customers', format: 'csv' });

let engine: EngineClient;
const sent: string[] = [];
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend({ beforeQuery: async (sql) => void sent.push(sql) }));
  for (const [s, file] of [
    [orders, 'orders.tsv'],
    [customers, 'customers.csv'],
  ] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());

const project = (...steps: Step[]) =>
  flow({
    sources: [orders, customers],
    nodes: [
      { id: 'in', type: 'source', sourceId: orders.id },
      { id: 'c', type: 'source', sourceId: customers.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });
const sql = (query: string, k = 0) => step(`q${k}`, 'customSql', { query });

async function run(...steps: Step[]) {
  const p = project(...steps);
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, schema.map((c) => c.name), 0))).table);
  return { names: schema.map((c) => c.name), rows: rows.map((r) => schema.map((c) => r[c.name])) };
}

describe('custom SQL step', () => {
  it('runs a grouped query, and later steps see its columns', async () => {
    const r = await run(sql('SELECT customer_id, sum(total) AS spent\nFROM input\nGROUP BY customer_id'), step('s', 'sortRows', { keys: [{ column: 'spent', descending: true }] }));
    expect(r.names).toEqual(['customer_id', 'spent']);
    expect(r.rows).toEqual([
      ['1', '15.75'],
      ['2', '8.0'],
    ]);
  });

  it('runs a window function', async () => {
    const r = await run(sql('SELECT order_id, row_number() OVER (PARTITION BY customer_id ORDER BY total DESC) AS rank FROM input ORDER BY order_id'));
    expect(r.rows).toEqual([
      ['100', '1'],
      ['101', '1'],
      ['102', '2'],
    ]);
  });

  it('runs a WITH query, FROM-first and PIVOT, after other steps', async () => {
    const withQuery = await run(step('f', 'filterRows', { mode: 'keep', match: 'all', conditions: [{ column: 'total', op: 'greater', value: '5' }], matchCase: true }), sql('WITH big AS (FROM input WHERE total > 10)\nSELECT count(*) AS n FROM big;', 1));
    expect(withQuery.rows).toEqual([['1']]);
    expect((await run(sql('FROM input SELECT max(order_id) AS last'))).rows).toEqual([['102']]);
    expect((await run(sql('PIVOT input ON customer_id IN (1, 2) USING count(*) GROUP BY order_id ORDER BY order_id'))).rows).toEqual([
      ['100', '1', '0'],
      ['101', '0', '1'],
      ['102', '1', '0'],
    ]);
  });

  it('chains two custom SQL steps', async () => {
    const r = await run(sql('SELECT customer_id, total * 2 AS doubled FROM input'), sql('SELECT sum(doubled) AS s FROM input', 1));
    expect(r.rows).toEqual([['47.5']]);
  });

  it('shows a DuckDB error with the line of the query it points at', async () => {
    const query = 'SELECT customer_id,\n  -- the total\n  sum(totl)\nFROM input\nGROUP BY 1';
    const p = project(sql(query));
    const compiled = compile(p, { nodeId: 't' }).sql;
    const error = await engine.describe(compiled).then(
      () => undefined,
      (e) => toEngineError(e),
    );
    expect(error?.message).toMatch(/totl/);
    expect(customSqlErrorLine(compiled, query, error!.detail!)).toEqual({ line: 3, text: 'sum(totl)' });
  });
});

describe('a custom SQL step sees only its input', () => {
  it('the other source is there to be read, which is what the checks stop', async () => {
    // Run directly, these read customers.csv; as a step, each is refused before any query is sent.
    const direct = [`SELECT count(*) FROM read_csv('${sourceFileName(customers)}')`, `SELECT count(*) FROM '${sourceFileName(customers)}'`, `SELECT count(*) FROM "${sourceFileName(customers)}"`];
    for (const q of direct) expect(tableRows((await engine.query(q)).table)[0]).toBeDefined();
    const before = sent.length;
    for (const q of [...direct, 'SELECT * FROM n_c', 'WITH n_c AS (SELECT * FROM n_c) SELECT * FROM n_c', "SELECT * FROM query('SELECT * FROM n_c')"]) {
      expect(() => compile(project(sql(q)), { nodeId: 't' }), q).toThrow(CompileError);
    }
    expect(sent.length).toBe(before);
  });

  it('every trick in the corpus is refused before compiling', () => {
    for (const [q, reason] of REFUSED) {
      if (reason.source === '^$') continue;
      expect(customSqlProblem(q), q).toBeDefined();
      expect(() => compile(project(sql(q)), { nodeId: 't' }), q).toThrow(CompileError);
    }
  });
});

describe('our lexer agrees with DuckDB’s', () => {
  let tokenize: Awaited<ReturnType<typeof createNodeTokenizer>>;
  beforeAll(async () => {
    tokenize = await createNodeTokenizer();
  });

  // Every query the checks accept, and the comment tricks, must split into the same strings, quoted names and
  // comments: a string DuckDB sees that we don't, or the reverse, is where a check could be fooled.
  const corpus = [...ACCEPTED, ...REFUSED.filter(([q]) => customSqlProblem(q) === undefined).map(([q]) => q)];

  it.each(corpus)('%s', (q) => {
    const raw = tokenize(q);
    // DuckDB counts UTF-8 bytes; we count UTF-16 code units.
    const byteToChar = new Map<number, number>();
    for (let i = 0, b = 0; i <= q.length; i++) {
      byteToChar.set(b, i);
      b += new TextEncoder().encode(q[i] ?? '').length;
    }
    const theirs = { types: raw.types, offsets: raw.offsets.map((b) => byteToChar.get(b) ?? -1) };
    const ours = lexSql(q);
    // Where DuckDB starts a string, so do we. (DuckDB's tokenizer skips comments rather than listing them.)
    theirs.offsets.forEach((at, i) => {
      if (theirs.types[i] !== TokenType.STRING_CONSTANT) return;
      expect(ours.find((t) => t.start === at)?.kind, `${q} @${at}`).toBe('string');
    });
    // Our strings and quoted names start where DuckDB's tokens do, and no DuckDB token starts inside one of them
    // or inside our comments.
    for (const t of ours.filter((x) => x.kind === 'string' || x.kind === 'quoted' || x.kind === 'comment')) {
      if (t.kind !== 'comment') expect(theirs.offsets, `${q}: ${t.text}`).toContain(t.start);
      expect(
        theirs.offsets.filter((at) => at > t.start && at < t.start + t.text.length),
        `${q}: ${t.text}`,
      ).toEqual([]);
    }
  });
});
