// Real DuckDB-WASM (Node build) behind the EngineClient, with Safari's mid-query stops simulated: now and then WebKit
// stops DuckDB inside an ordinary query with a WebAssembly trap, which the worker passes on as a RuntimeError.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disableOptimizers } from '../../src/compiler/sql';
import { EngineClient, isEngineTrap, PLAN_COPY_OPTIMIZERS, tableRows } from '../../src/engine/client';
import type { DuckBackend } from '../../src/engine/types';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../fixtures', name)));
const COUNT = `SELECT count(*)::INTEGER AS n FROM read_csv('customers.csv')`;

function trap(message = "Unreachable code should not be executed (evaluating 'u(..._)')") {
  const e = new Error(message);
  e.name = 'RuntimeError';
  return e;
}

let backend: DuckBackend;
let engine: EngineClient;
let sent: string[];
let reconnects: number;
/** How many of the next queries matching `traps` stop with a trap. */
let trapsLeft: number;
let traps: (sql: string) => boolean;

beforeEach(async () => {
  sent = [];
  reconnects = 0;
  trapsLeft = 0;
  traps = () => true;
  backend = await createNodeBackend({
    beforeQuery: async (sql) => {
      sent.push(sql);
      if (trapsLeft > 0 && traps(sql)) {
        trapsLeft--;
        throw trap();
      }
    },
  });
  const reconnect = backend.reconnect.bind(backend);
  backend.reconnect = async () => {
    reconnects++;
    await reconnect();
  };
  engine = new EngineClient(backend);
  await engine.registerBuffer('customers.csv', fixture('customers.csv'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await engine.close();
});

describe('a query DuckDB stops inside', () => {
  // Regression (WebKit): a trap in the middle of a query broke a source ("access to a null reference") or left the
  // results saying "This result can’t be shown" (Unreachable code should not be executed).
  it('runs once more on a new connection, which still has the files, tables and settings', async () => {
    await engine.query(`CREATE TABLE kept AS SELECT 1 AS k`);
    await engine.query(disableOptimizers(PLAN_COPY_OPTIMIZERS));
    trapsLeft = 1;
    expect(tableRows((await engine.query(COUNT)).table)).toEqual([{ n: 4 }]);
    expect(sent.filter((s) => s === COUNT)).toHaveLength(2);
    expect(reconnects).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^DuckDB stopped inside a query \(Unreachable code should not be executed/));

    expect(tableRows((await engine.query(`SELECT k FROM kept`)).table)).toEqual([{ k: 1 }]);
    expect(tableRows((await engine.query(`SELECT current_setting('disabled_optimizers') AS s`)).table)).toEqual([{ s: 'cte_inlining,common_subplan' }]);
  });

  it('reads columns the same way', async () => {
    trapsLeft = 1;
    traps = (sql) => sql.startsWith('DESCRIBE');
    expect((await engine.describe(`SELECT * FROM read_csv('customers.csv')`)).map((c) => c.name)).toEqual(['id', 'name', 'email', 'joined']);
    expect(reconnects).toBe(1);
  });

  it('shows the error when it stops again, and tries only once per query', async () => {
    trapsLeft = 2;
    await expect(engine.query(COUNT)).rejects.toThrow(/Unreachable code should not be executed/);
    expect(sent.filter((s) => s === COUNT)).toHaveLength(2);
    expect(reconnects).toBe(1);
    // The next query is a query of its own.
    expect(tableRows((await engine.query(COUNT)).table)).toEqual([{ n: 4 }]);
  });

  it('leaves DuckDB’s own errors alone', async () => {
    await expect(engine.query(`SELECT * FROM read_csv('missing.csv')`)).rejects.toThrow();
    expect(reconnects).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('isEngineTrap', () => {
  it('knows WebAssembly traps and nothing else', () => {
    expect(isEngineTrap(trap())).toBe(true);
    expect(isEngineTrap(trap("access to a null reference (evaluating 'u(..._)')"))).toBe(true);
    expect(isEngineTrap(new Error("access to a null reference (evaluating 'u(..._)')"))).toBe(true);
    expect(isEngineTrap(new WebAssembly.RuntimeError('unreachable'))).toBe(true);
    expect(isEngineTrap(new Error('Binder Error: column "x" not found'))).toBe(false);
    expect(isEngineTrap(new Error('IO Error: No files found that match the pattern "missing.csv"'))).toBe(false);
    expect(isEngineTrap('Unreachable code should not be executed')).toBe(false);
  });
});
