// The spreadsheet formats besides .xlsx (#191) on real DuckDB-WASM, through the Excel worker's service: each fixture
// under tests/fixtures/formats/ was written from the same workbook as sales.xlsx, so each reads as the same table,
// with the differences a format can't help (a dBase table has no empty numbers, Lotus has no booleans) stated.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { inProcessClient, setExcelClient } from '../../src/excel/client';
import { ExcelService } from '../../src/excel/service';
import { createProject, useProjectStore } from '../../src/model';
import { addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { resetExcelSources, syncExcelSources, useExcelReads } from '../../src/sources/excel';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => readFileSync(join(__dirname, name === 'sales.xlsx' ? '../fixtures' : '../fixtures/formats', name));

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  setExcelClient(inProcessClient(new ExcelService()));
  resetExcelSources();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Formats'));
});
afterEach(() => setExcelClient(undefined));

const project = () => useProjectStore.getState().history.present;

/** The file added as Puddle adds it (sniffed, then read by the Excel service into DuckDB): its read, types and rows. */
async function open(name: string) {
  const source = await addFileSource(new File([fixture(name)], name));
  expect(source.format).toBe('xlsx');
  await syncExcelSources(engine, project());
  const read = useExcelReads.getState().reads[source.id];
  if (read?.state !== 'ok') throw new Error(`${name}: ${JSON.stringify(read)}`);
  const nodeId = project().nodes.find((n) => n.type === 'source' && n.sourceId === source.id)!.id;
  const sql = compile(project(), { nodeId }).sql;
  return { read, types: (await engine.describe(sql)).map((c) => `${c.name} ${c.type}`), rows: tableRows((await engine.query(sql)).table) };
}

describe('spreadsheet formats', () => {
  it.each(['sales.xls', 'sales.xlsb', 'sales.xlsm', 'sales.ods', 'sales.fods', 'sales.numbers'])('%s opens with the same sheets, types and rows as sales.xlsx', async (name) => {
    const xlsx = await open('sales.xlsx');
    const other = await open(name);
    expect(other.read.sheets.slice(0, 2)).toEqual(xlsx.read.sheets.slice(0, 2));
    expect(other.read).toMatchObject({ sheet: 'Sales', headerRow: 3, range: 'A3:H7', rows: 4 });
    expect(other.types).toEqual(xlsx.types);
    expect(other.rows).toEqual(xlsx.rows);
  });

  it('a BIFF5 .xls, SYLK and Lotus 1-2-3 files hold the same rows with what each format can keep', async () => {
    const xlsx = await open('sales.xlsx');
    const biff5 = await open('sales-biff5.xls');
    expect(biff5.types).toEqual(xlsx.types.map((t) => t.replace('Contact_2', 'Column G')));
    expect(biff5.rows.map((r) => r['Amount'])).toEqual(xlsx.rows.map((r) => r['Amount']));
    const sylk = await open('sales.slk');
    expect(sylk.types).toEqual(biff5.types);
    expect(sylk.rows.map((r) => [r['Region'], r['Order date'], r['Paid']])).toEqual(xlsx.rows.map((r) => [r['Region'], r['Order date'], r['Paid']]));
    const lotus = await open('sales.wk1');
    expect(lotus.types).toEqual(['Region VARCHAR', 'Order date DATE', 'Amount VARCHAR', 'Paid VARCHAR', 'Notes VARCHAR', 'Contact VARCHAR', 'Column G VARCHAR', 'Column H BIGINT']);
    expect(lotus.rows.map((r) => r['Paid'])).toEqual(['TRUE', 'FALSE', 'TRUE', 'FALSE']);
  });

  it('a DIF file keeps no number formats, so its dates are the serials Parse dates reads', async () => {
    const dif = await open('sales.dif');
    expect(dif.types[1]).toBe('Order date BIGINT');
    expect(dif.rows.map((r) => r['Order date'])).toEqual([46027, 46063, 46096, 46112]);
  });

  it('a dBase table opens with its field types: character, date, numeric and logical', async () => {
    const dbf = await open('sales.dbf');
    expect(dbf.read).toMatchObject({ headerRow: 1, range: 'A1:E5', rows: 4, sheets: [{ name: 'Sheet1', rows: 5, columns: 5 }] });
    expect(dbf.types).toEqual(['Region VARCHAR', 'Order date DATE', 'Amount DOUBLE', 'Paid BOOLEAN', 'Notes VARCHAR']);
    expect(dbf.rows[0]).toEqual({ Region: 'North', 'Order date': Date.UTC(2026, 0, 5), Amount: 120.5, Paid: true, Notes: 'First order' });
    expect(dbf.rows[1]!['Notes']).toBeNull();
  });
});
