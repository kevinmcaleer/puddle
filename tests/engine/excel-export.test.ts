// Excel exports on real DuckDB-WASM (Node build): rows come out of DuckDB as Arrow, SheetJS writes them (the
// worker's service, run in process), and the workbook is read back with SheetJS.
import { tableToIPC } from 'apache-arrow';
import { sheetColumn, sourceFileName } from '../../src/compiler';
import { EngineClient } from '../../src/engine/client';
import { inProcessClient, setExcelClient } from '../../src/excel/client';
import { SHEET_ROWS } from '../../src/excel/limits';
import { parseWorkbook, readSheet } from '../../src/excel/read';
import { ExcelService } from '../../src/excel/service';
import { ExportBlocked, runExport, sheetNameFor, type Delivery } from '../../src/export/run';
import { exportGate } from '../../src/flow/gate';
import { evaluateRules, useRuleStore } from '../../src/flow/rules';
import { evaluateFlow, invalidateCaches } from '../../src/flow/status';
import type { OutputNode, Project, Rule } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const ORDERS = ['id,name,amount,paid,ordered,arrived', '1,Ann,120.5,true,2026-01-05,2026-01-05 09:30:00', '2,,80,false,,2026-01-06 14:00:05', '3,Cy,,,1999-12-31,'].join('\n');
const orders = src({ id: 'orders', format: 'csv' });
const big = src({ id: 'big', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerText(sourceFileName(orders), ORDERS);
  // One row more than a sheet holds below its header.
  await engine.registerText(sourceFileName(big), 'n\n' + Array.from({ length: SHEET_ROWS }, (_, i) => i).join('\n'));
  setExcelClient(inProcessClient(new ExcelService()));
});
afterAll(async () => {
  setExcelClient(undefined);
  await engine.close();
});
beforeEach(() => invalidateCaches());

const output = (source = orders, options: Record<string, unknown> = {}, rules: Rule[] = []): Project => {
  const p = flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }, { id: 'out', type: 'output' }], wires: [['in', 'out']] });
  return {
    ...p,
    nodes: p.nodes.map((n) => (n.id === 'out' && n.type === 'output' ? { ...n, name: 'Orders: 2026', outputSpec: { format: 'xlsx', options }, rules } : n.id === 'in' ? { ...n, rules } : n)),
  };
};

const delivered: { blob: Blob; name: string; format: string }[] = [];
const deliver: Delivery = async (blob, name, format) => void delivered.push({ blob, name, format });
beforeEach(() => (delivered.length = 0));

const book = async () => parseWorkbook(new Uint8Array(await delivered.at(-1)!.blob.arrayBuffer()));

describe('Excel exports', () => {
  it('write a workbook that reads back with the same rows, columns and types', async () => {
    const p = output();
    const entry = await runExport(engine, p, 'out', { gate: { state: 'clear' }, deliver });
    expect(entry).toMatchObject({ nodeName: 'Orders: 2026', format: 'xlsx', fileName: 'Orders- 2026.xlsx', rows: 3 });
    expect(delivered.map((d) => [d.name, d.format, d.blob.type])).toEqual([['Orders- 2026.xlsx', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]);

    const types = await engine.describe(`SELECT * FROM read_csv('${sourceFileName(orders)}')`);
    expect(types.map((c) => c.type)).toEqual(['BIGINT', 'VARCHAR', 'DOUBLE', 'BOOLEAN', 'DATE', 'TIMESTAMP']);

    const wb = await book();
    // The node's name, made into a valid sheet name.
    expect(wb.SheetNames).toEqual(['Orders 2026']);
    const data = readSheet(wb);
    expect(data).toMatchObject({ headerRow: 1, rows: 3 });
    expect(data.columns.map((c) => `${c.name} ${c.type}`)).toEqual(types.map((c) => `${c.name} ${c.type}`));
    expect(data.columns.map((c) => c.values)).toEqual([
      [1, 2, 3],
      ['Ann', null, 'Cy'],
      [120.5, 80, null],
      [true, false, null],
      [Date.UTC(2026, 0, 5) / 86_400_000, null, Date.UTC(1999, 11, 31) / 86_400_000],
      [Date.UTC(2026, 0, 5, 9, 30), Date.UTC(2026, 0, 6, 14, 0, 5), null],
    ]);
  });

  it('use the sheet name and header options', async () => {
    const p = output(orders, { sheetName: 'Tidy', header: false });
    expect(sheetNameFor(p.nodes.find((n) => n.id === 'out') as OutputNode)).toBe('Tidy');
    await runExport(engine, p, 'out', { gate: { state: 'clear' }, deliver });
    const wb = await book();
    expect(wb.SheetNames).toEqual(['Tidy']);
    expect(readSheet(wb, { headerRow: 0 })).toMatchObject({ rows: 3, columns: expect.arrayContaining([expect.objectContaining({ name: 'Column A', values: [1, 2, 3] })]) });
  });

  it('refuse a sheet name Excel would reject before writing anything', async () => {
    await expect(runExport(engine, output(orders, { sheetName: 'a/b' }), 'out', { gate: { state: 'clear' }, deliver })).rejects.toThrow('Sheet names can’t contain \\ / ? * [ ] or :. Change the sheet name in the export settings.');
    expect(delivered).toHaveLength(0);
  });

  it('above the row limit, don’t run and say why', async () => {
    await expect(runExport(engine, output(big), 'out', { gate: { state: 'clear' }, deliver })).rejects.toThrow(
      'This output has 1,048,576 rows; an Excel sheet holds at most 1,048,575 below its header. Export it as CSV or Parquet instead, which have no row limit.',
    );
    expect(delivered).toHaveLength(0);
  });

  it('go through the quality gate like any other format', async () => {
    const failing: Rule = { id: 'spaces', type: 'noEdgeSpaces', label: 'No leading or trailing spaces in name', enabled: true, severity: 'fail', params: { column: 'name' } };
    const p = output(orders, {}, [failing]);
    await evaluateFlow(engine, p);
    await evaluateRules(engine, p);
    const gate = exportGate(p, 'out', useRuleStore.getState().nodes);
    // The orders have no padded names, so add one through a source that does.
    expect(gate.state).toBe('clear');
    const padded = src({ id: 'padded', format: 'csv' });
    await engine.registerText(sourceFileName(padded), 'name\n  Ann \nBob');
    const q = output(padded, {}, [failing]);
    await evaluateFlow(engine, q);
    await evaluateRules(engine, q);
    const blocked = exportGate(q, 'out', useRuleStore.getState().nodes);
    await expect(runExport(engine, q, 'out', { gate: blocked, deliver })).rejects.toThrow(ExportBlocked);
    expect(delivered).toHaveLength(0);
    const entry = await runExport(engine, q, 'out', { gate: blocked, override: true, deliver });
    expect(entry).toMatchObject({ format: 'xlsx', rows: 2, overridden: expect.arrayContaining([{ nodeName: 'in', rule: failing.label, nodeId: 'in', ruleId: 'spaces' }]) });
    expect(readSheet(await book()).columns[0]!.values).toEqual(['  Ann ', 'Bob']);
  });

  it('turn DuckDB types Excel has no cell for into numbers, timestamps or text', async () => {
    const sql = `SELECT CAST(1.25 AS DECIMAL(9,2)) AS d, CAST(170141183460469231731687303715884105727 AS HUGEINT) AS h, TIME '10:30:00' AS t, TIMESTAMPTZ '2026-01-05 09:30:00+00' AS tz, [1, 2] AS l, {'a': 1} AS s, CAST(5 AS BIGINT) AS b`;
    const columns = await engine.describe(sql);
    const rows = await engine.query(`SELECT ${columns.map(sheetColumn).join(', ')} FROM (${sql})`);
    const { data } = await new ExcelService().run('write', { ipc: tableToIPC(rows.table, 'stream'), options: { sheetName: 'S', header: true, freezeHeader: true } });
    const back = readSheet(parseWorkbook(data));
    expect(back.columns.map((c) => [c.name, c.type, c.values[0]])).toEqual([
      ['d', 'DOUBLE', 1.25],
      ['h', 'VARCHAR', '170141183460469231731687303715884105727'],
      ['t', 'VARCHAR', '10:30:00'],
      ['tz', 'TIMESTAMP', Date.UTC(2026, 0, 5, 9, 30)],
      ['l', 'VARCHAR', '[1, 2]'],
      ['s', 'VARCHAR', '{\'a\': 1}'],
      ['b', 'BIGINT', 5],
    ]);
  });
});
