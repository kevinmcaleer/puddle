// Exports on real DuckDB-WASM (Node build): COPY ... TO round-trips, row counts, and the quality gate.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileExport, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { ExportBlocked, runExport, type Delivery } from '../../src/export/run';
import { exportGate } from '../../src/flow/gate';
import { evaluateRules, useRuleStore } from '../../src/flow/rules';
import { evaluateFlow, invalidateCaches } from '../../src/flow/status';
import type { OutputNode, Project, Rule } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(cust), new Uint8Array(readFileSync(join(__dirname, '../fixtures', 'customers.csv'))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

const output = (spec: Partial<OutputNode['outputSpec']> = {}, rules: Rule[] = []): Project => {
  const p = flow({ sources: [cust], nodes: [{ id: 'in', type: 'source', sourceId: cust.id }, { id: 'out', type: 'output' }], wires: [['in', 'out']] });
  return {
    ...p,
    nodes: p.nodes.map((n) => (n.id === 'out' && n.type === 'output' ? { ...n, name: 'Customers', outputSpec: { ...n.outputSpec, ...spec }, rules } : n.id === 'in' ? { ...n, rules } : n)),
  };
};

/** Export, then read the written file back through DuckDB as a new source. */
async function roundTrip(p: Project, read: (file: string) => string) {
  const { blob, rows } = await engine.exportFile(`out_${Math.random().toString(36).slice(2)}.txt`, (path) => compileExport(p, 'out', path));
  const name = `back_${Math.random().toString(36).slice(2)}`;
  await engine.registerBuffer(name, new Uint8Array(await blob.arrayBuffer()));
  const back = await engine.query(`SELECT * FROM ${read(name)}`);
  return { rows, back: tableRows(back.table), columns: back.columns.map((c) => c.name), text: await blob.text() };
}

describe('export formats', () => {
  it('writes CSV that reads back with the same rows and columns', async () => {
    const p = output();
    const original = tableRows((await engine.query(compile(p, { nodeId: 'out' }).sql)).table);
    const r = await roundTrip(p, (f) => `read_csv('${f}')`);
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual(['id', 'name', 'email', 'joined']);
    expect(r.back.map((x) => x.id)).toEqual(original.map((x) => x.id));
    expect(r.back[0]!.name).toBe(original[0]!.name);
  });

  it('honours the delimiter and header options', async () => {
    const r = await roundTrip(output({ options: { delimiter: ';', header: false } }), (f) => `read_csv('${f}', delim = ';', header = false)`);
    expect(r.text.split('\n')[0]).toMatch(/^1;/);
    expect(r.back).toHaveLength(4);
  });

  it('copies tab-separated text for the clipboard', async () => {
    const r = await roundTrip(output({ format: 'clipboard' }), (f) => `read_csv('${f}', delim = '\t')`);
    expect(r.text.split('\n')[0]).toBe('id\tname\temail\tjoined');
    expect(r.back).toHaveLength(4);
  });

  // JSON and Parquet writers are DuckDB extensions, which this hermetic backend can't download (see
  // engine.test.ts). Their round-trips run in the browser once the extensions are self-hosted.
  it.each(['parquet', 'json', 'ndjson'] as const)('says plainly when %s needs an extension that can’t load', async (format) => {
    const ext = format === 'parquet' ? 'parquet' : 'json';
    await expect(engine.exportFile(`x.${format}`, (path) => compileExport(output({ format }), 'out', path))).rejects.toMatchObject({
      code: 'missing-extension',
      message: expect.stringContaining(`${ext} extension`),
    });
  });
});

describe('the quality gate', () => {
  const failing: Rule = { id: 'spaces', type: 'noEdgeSpaces', label: 'No leading or trailing spaces in name', enabled: true, severity: 'fail', params: { column: 'name' } };
  const delivered: { name: string; size: number }[] = [];
  const deliver: Delivery = async (blob, name) => void delivered.push({ name, size: blob.size });

  async function gateFor(p: Project) {
    await evaluateFlow(engine, p);
    await evaluateRules(engine, p);
    return exportGate(p, 'out', useRuleStore.getState().nodes);
  }

  it('blocks an export downstream of a failing rule, naming it, until overridden', async () => {
    const p = output({}, [failing]);
    const gate = await gateFor(p);
    expect(gate).toMatchObject({ state: 'blocked', blocking: [{ nodeName: 'in', label: failing.label, failures: 2 }, { nodeName: 'Customers', failures: 2 }] });
    await expect(runExport(engine, p, 'out', { gate, deliver })).rejects.toThrow(ExportBlocked);
    await expect(runExport(engine, p, 'out', { gate, deliver })).rejects.toThrow(/No leading or trailing spaces in name fails on 2 rows in in\./);
    expect(delivered).toHaveLength(0);

    const entry = await runExport(engine, p, 'out', { gate, override: true, deliver });
    expect(entry).toMatchObject({ nodeName: 'Customers', format: 'csv', fileName: 'Customers.csv', rows: 4, overridden: [{ nodeName: 'in', rule: failing.label }, { nodeName: 'Customers', rule: failing.label }] });
    expect(delivered).toEqual([{ name: 'Customers.csv', size: expect.any(Number) }]);
  });

  it('lets warnings and disabled rules through', async () => {
    const p = output({ fileName: 'tidy' }, [{ ...failing, severity: 'warn' }, { ...failing, id: 'off', enabled: false }]);
    const gate = await gateFor(p);
    expect(gate).toEqual({ state: 'clear' });
    const entry = await runExport(engine, p, 'out', { gate, deliver });
    expect(entry).toMatchObject({ fileName: 'tidy.csv', rows: 4 });
    expect(entry.overridden).toBeUndefined();
  });
});
