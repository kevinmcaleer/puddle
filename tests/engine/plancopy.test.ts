// Real DuckDB-WASM (Node build) behind the EngineClient, with Safari's plan-copy failure simulated: WebKit lets
// DuckDB's "CSVReaderSerialize not implemented" escape from optimizers that copy a plan reading a CSV file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disableOptimizers } from '../../src/compiler/sql';
import { EngineClient, isPlanCopyFailure, PLAN_COPY_OPTIMIZERS, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../fixtures', name)));
const off = disableOptimizers(PLAN_COPY_OPTIMIZERS);
const JOIN = `SELECT o.order_id, c.name FROM read_csv('orders.csv') o JOIN read_csv('customers.csv') c USING (customer_id) ORDER BY o.order_id`;

let engine: EngineClient;
let sent: string[];
/** Which queries fail as WebKit fails them, until the plan-copying optimizers are off. */
let failing: (sql: string) => boolean;

beforeEach(async () => {
  sent = [];
  failing = () => false;
  engine = new EngineClient(
    await createNodeBackend({
      beforeQuery: async (sql) => {
        sent.push(sql);
        if (failing(sql)) throw new Error('Not implemented Error: CSVReaderSerialize not implemented');
      },
    }),
  );
  await engine.registerBuffer('orders.csv', fixture('shop-orders.csv'));
  await engine.registerBuffer('customers.csv', fixture('shop-customers.csv'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await engine.close();
});

describe('a query DuckDB fails to copy the plan of', () => {
  it('runs again with the plan-copying optimizers off, and later queries run without them', async () => {
    const expected = tableRows((await engine.query(JOIN)).table);
    failing = (sql) => sql.includes('JOIN') && !sent.includes(off);

    expect(tableRows((await engine.query(JOIN)).table)).toEqual(expected);
    expect(sent.filter((s) => s === off)).toHaveLength(1);
    const setting = tableRows((await engine.query(`SELECT current_setting('disabled_optimizers') AS s`)).table);
    expect(setting).toEqual([{ s: 'cte_inlining,common_subplan' }]);

    // Columns are read the same way, and the setting isn't sent again.
    expect((await engine.describe(JOIN)).map((c) => c.name)).toEqual(['order_id', 'name']);
    expect(tableRows((await engine.query(JOIN)).table)).toEqual(expected);
    expect(sent.filter((s) => s === off)).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('shows the error when turning the optimizers off doesn’t help, and tries only once', async () => {
    failing = (sql) => sql.includes('JOIN');
    await expect(engine.query(JOIN)).rejects.toThrow(/CSVReaderSerialize not implemented/);
    await expect(engine.query(JOIN)).rejects.toThrow(/CSVReaderSerialize not implemented/);
    expect(sent.filter((s) => s === off)).toHaveLength(1);
  });

  it('leaves other errors alone', async () => {
    await expect(engine.query(`SELECT * FROM read_csv('missing.csv')`)).rejects.toThrow();
    expect(sent).not.toContain(off);
  });
});

describe('isPlanCopyFailure', () => {
  it('knows DuckDB’s serialise failures and nothing else', () => {
    expect(isPlanCopyFailure(new Error('Not implemented Error: CSVReaderSerialize not implemented'))).toBe(true);
    expect(isPlanCopyFailure('ParquetScanSerialize not implemented')).toBe(true);
    expect(isPlanCopyFailure(new Error('Not implemented Error: this function is not implemented'))).toBe(false);
    expect(isPlanCopyFailure(new Error('Binder Error: column "x" not found'))).toBe(false);
  });
});
