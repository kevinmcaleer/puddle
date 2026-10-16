import { flow, src } from '../../tests/helpers/projects';
import { compileExport, compileFullCount, compileFullData, compileSheetExport, exportFileName, exportOptions, sheetColumn } from './export';

const p = flow({
  sources: [src({ id: 'cust', format: 'csv' })],
  nodes: [
    { id: 'src', type: 'source', sourceId: 'cust' },
    { id: 'out', type: 'output' },
  ],
  wires: [['src', 'out']],
});

describe('compileExport', () => {
  it.each([
    [{ format: 'csv', options: {} }],
    [{ format: 'csv', options: { delimiter: '\t', header: false } }],
    [{ format: 'clipboard', options: {} }],
    [{ format: 'parquet', options: { compression: 'snappy' } }],
    [{ format: 'json', options: {} }],
    [{ format: 'ndjson', options: {} }],
  ] as const)('%j', (spec) => {
    expect(compileExport(p, 'out', "o'ut.file", spec)).toMatchSnapshot();
  });

  it('always exports the full data, even from a sample-mode copy of the project', () => {
    const sampled = { ...p, sources: p.sources.map((s) => ({ ...s, sampleRows: 100 })) };
    expect(compileExport(sampled, 'out', 'f')).toBe(compileExport(p, 'out', 'f'));
    expect(compileExport(sampled, 'out', 'f')).not.toContain('LIMIT 100');
  });

  it('uses the node’s own settings, and only exports Output nodes', () => {
    expect(compileExport(p, 'out', 'f')).toContain('(FORMAT csv, HEADER true, DELIMITER \',\')');
    expect(() => compileExport(p, 'src', 'f')).toThrow(/isn’t an Output node/);
    expect(() => compileExport(p, 'gone', 'f')).toThrow(/no longer in the project/);
  });

  it('refuses options DuckDB would choke on', () => {
    expect(() => exportOptions({ format: 'csv', options: { delimiter: "'; DROP" } })).toThrow(/CSV options are invalid/);
    expect(() => exportOptions({ format: 'parquet', options: { compression: 'brotli' } })).toThrow(/Parquet options/);
    expect(exportOptions({ format: 'csv', options: { stray: 1 } })).toEqual({ delimiter: ',', header: true });
  });
});

describe('exportFileName', () => {
  it.each([
    ['Customers', {}, 'csv', 'Customers.csv'],
    ['Customers', { fileName: 'tidy' }, 'parquet', 'tidy.parquet'],
    ['customers.csv', {}, 'parquet', 'customers.parquet'],
    ['Out', { fileName: 'a/b:c?.json' }, 'json', 'a-b-c-.json'],
    ['Out', { fileName: '  ' }, 'ndjson', 'Out.ndjson'],
    ['', {}, 'csv', 'export.csv'],
    ['Report.', {}, 'csv', 'Report.csv'],
    ['Customers', {}, 'xlsx', 'Customers.xlsx'],
    ['customers.csv', {}, 'xlsx', 'customers.xlsx'],
    ['Out', { fileName: 'book.xlsx' }, 'csv', 'book.csv'],
  ] as const)('%s %j as %s is %s', (name, spec, format, expected) => {
    expect(exportFileName(name, { format, ...spec })).toBe(expected);
  });
});

describe('Excel exports', () => {
  it('have their own options, with the header on and frozen by default', () => {
    expect(exportOptions({ format: 'xlsx', options: {} })).toEqual({ header: true, freezeHeader: true });
    expect(exportOptions({ format: 'xlsx', options: { sheetName: 'Orders', header: false, freezeHeader: false, stray: 1 } })).toEqual({ sheetName: 'Orders', header: false, freezeHeader: false });
    expect(() => exportOptions({ format: 'xlsx', options: { header: 'yes' } })).toThrow(/Excel options are invalid/);
  });

  it('aren’t written by COPY', () => {
    expect(() => compileExport(p, 'out', 'f', { format: 'xlsx', options: {} })).toThrow(/written by SheetJS/);
  });

  it.each([
    ['BIGINT', '"c"'],
    ['VARCHAR', '"c"'],
    ['DATE', '"c"'],
    ['TIMESTAMP', '"c"'],
    ['BOOLEAN', '"c"'],
    ['DOUBLE', '"c"'],
    ['DECIMAL(18,3)', 'CAST("c" AS DOUBLE) AS "c"'],
    ['TIMESTAMP WITH TIME ZONE', 'CAST("c" AS TIMESTAMP) AS "c"'],
    ['TIMESTAMP_NS', 'CAST("c" AS TIMESTAMP) AS "c"'],
    ['HUGEINT', 'CAST("c" AS VARCHAR) AS "c"'],
    ['TIME', 'CAST("c" AS VARCHAR) AS "c"'],
    ['STRUCT(a INTEGER)', 'CAST("c" AS VARCHAR) AS "c"'],
    ['INTEGER[]', 'CAST("c" AS VARCHAR) AS "c"'],
  ])('write a %s column as %s', (type, sql) => {
    expect(sheetColumn({ name: 'c', type })).toBe(sql);
  });

  it('read the full data, quoting column names', () => {
    const sampled = { ...p, sources: p.sources.map((s) => ({ ...s, sampleRows: 100 })) };
    const sql = compileSheetExport(sampled, 'out', [{ name: 'id', type: 'BIGINT' }, { name: 'a "b"', type: 'DECIMAL(9,2)' }]);
    expect(sql).toMatchSnapshot();
    expect(sql).not.toContain('LIMIT 100');
    expect(compileFullData(sampled, 'out')).toBe(compileFullData(p, 'out'));
    expect(compileFullCount(sampled, 'out')).toBe(`SELECT COUNT(*) AS n FROM (${compileFullData(p, 'out')})`);
    expect(() => compileSheetExport(p, 'gone', [])).toThrow(/no longer in the project/);
  });
});
