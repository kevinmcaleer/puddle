import { flow, src } from '../../tests/helpers/projects';
import { compileExport, exportFileName, exportOptions } from './export';

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
  ] as const)('%s %j as %s is %s', (name, spec, format, expected) => {
    expect(exportFileName(name, { format, ...spec })).toBe(expected);
  });
});
