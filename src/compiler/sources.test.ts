import type { Source } from '../model';
import { compileAccessLoad, sourceFileName, sourceRelation, sourceTableName } from './sources';

const feed = (odata: NonNullable<NonNullable<Source['url']>['odata']>): Source => ({
  id: 'a',
  name: 'People',
  kind: 'url',
  format: 'csv',
  url: { href: 'https://services.odata.org/TripPinRESTierService', odata },
  parseOptions: { delimiter: ';' },
  detectedSchema: [],
});

describe('reading an OData feed', () => {
  it('reads the CSV Puddle wrote with the types from $metadata, keeping empty strings apart from nulls', () => {
    expect(sourceRelation(feed({ entitySet: 'People', version: 4, columns: [{ name: 'UserName', type: 'VARCHAR' }, { name: "O'Age", type: 'BIGINT' }] }))).toBe(
      `read_csv('src_a.csv', header = true, delim = ',', quote = '"', escape = '"', allow_quoted_nulls = false, columns = {'UserName': 'VARCHAR', 'O''Age': 'BIGINT'})`,
    );
  });

  it('lets DuckDB type the columns when the service has no $metadata, and ignores read options', () => {
    expect(sourceRelation(feed({ entitySet: 'People', version: 4 }))).toBe(`read_csv('src_a.csv', header = true, delim = ',', quote = '"', escape = '"', allow_quoted_nulls = false)`);
  });
});

describe('reading a table of an Access database', () => {
  const table = (parseOptions: Source['parseOptions'], headHash = 'h1'): Source => ({
    id: 'a',
    name: 'shop.accdb',
    kind: 'file',
    format: 'access',
    file: { originalName: 'shop.accdb', size: 1, lastModified: 0, headHash },
    parseOptions,
    detectedSchema: [],
  });

  it('reads the loaded table, named for the file and the table so neither is mistaken for another', () => {
    const name = sourceTableName(table({ table: 'Orders' }));
    expect(name).toMatch(/^src_a_[0-9a-f]{12}$/);
    expect(sourceRelation(table({ table: 'Orders' }))).toBe(`"${name}"`);
    expect(sourceTableName(table({ table: 'Customers' }))).not.toBe(name);
    expect(sourceTableName(table({ table: 'Orders' }, 'h2'))).not.toBe(name);
  });

  it('loads each column with its Access type, and anything unexpected as text', () => {
    const columns = [
      { name: 'Amount', sqlType: 'DECIMAL(19,4)' },
      { name: 'Qty', sqlType: 'SMALLINT' },
      { name: 'Odd"name', sqlType: 'VARCHAR); DROP TABLE x; --' },
    ];
    expect(compileAccessLoad('t', columns, { staging: 't_arrow' })).toBe(
      `CREATE OR REPLACE TABLE "t" AS SELECT CAST("Amount" AS DECIMAL(19,4)) AS "Amount", CAST("Qty" AS SMALLINT) AS "Qty", CAST("Odd""name" AS VARCHAR) AS "Odd""name" FROM "t_arrow"`,
    );
  });

  it('loads the runner’s copy from a CSV of text, keeping empty text apart from empty values', () => {
    expect(compileAccessLoad('t', [{ name: 'Qty', sqlType: 'SMALLINT' }], { csv: "t's.csv" })).toBe(
      `CREATE OR REPLACE TABLE "t" AS SELECT CAST("Qty" AS SMALLINT) AS "Qty" FROM read_csv('t''s.csv', header = true, all_varchar = true, delim = ',', quote = '"', escape = '"', allow_quoted_nulls = false)`,
    );
  });
});

describe('reading delimited text around a table', () => {
  const text = (parseOptions: Source['parseOptions']): Source => ({
    id: 'a',
    name: 'report.txt',
    kind: 'file',
    format: 'csv',
    file: { originalName: 'report.txt', size: 1, lastModified: 0, headHash: 'h1' },
    parseOptions,
    detectedSchema: [],
  });

  it('skips a banner at the top as DuckDB’s skip, and names the columns itself when told to, all as text', () => {
    expect(sourceRelation(text({ skip: 5 }))).toBe(`read_csv('src_a.csv', skip = 5, null_padding = true)`);
    expect(sourceRelation(text({ skip: 0, columns: [] }))).toBe(`read_csv('src_a.csv', null_padding = true)`);
    expect(sourceRelation(text({ skip: 2, columns: ['id', "O'Brien"] }))).toBe(`read_csv('src_a.csv', skip = 2, null_padding = true, header = true, auto_detect = false, columns = {'id': 'VARCHAR', 'O''Brien': 'VARCHAR'}, strict_mode = false)`);
    expect(sourceRelation(text({ skip: 3, header: false, columns: ['column0', 'column1'] }))).toBe(`read_csv('src_a.csv', header = false, skip = 3, null_padding = true, auto_detect = false, columns = {'column0': 'VARCHAR', 'column1': 'VARCHAR'}, strict_mode = false)`);
  });

  it('drops a footer by counting rows from the end, in file order', () => {
    expect(sourceRelation(text({ delimiter: '|', skipBottom: 2 }))).toBe(
      `(SELECT * EXCLUDE ("__puddle_row", "__puddle_total") FROM (SELECT *, row_number() OVER () AS "__puddle_row", count(*) OVER () AS "__puddle_total" FROM read_csv('src_a.csv', delim = '|', null_padding = true)) WHERE "__puddle_row" <= "__puddle_total" - 2)`,
    );
  });
});

describe('reading fixed-width text and pipe tables', () => {
  const text = (format: 'fixed' | 'pipes', parseOptions: Source['parseOptions'], headHash = 'h1'): Source => ({
    id: 'a',
    name: 'report.txt',
    kind: 'file',
    format,
    file: { originalName: 'report.txt', size: 1, lastModified: 0, headHash },
    parseOptions,
    detectedSchema: [],
  });

  it('reads the CSV Puddle wrote from the text, named for the file and the read options', () => {
    const name = sourceFileName(text('fixed', { boundaries: [8, 30] }));
    expect(name).toMatch(/^src_a_[0-9a-f]{12}\.csv$/);
    expect(sourceFileName(text('fixed', { boundaries: [8, 31] }))).not.toBe(name);
    expect(sourceFileName(text('fixed', { boundaries: [8, 30], skip: 1 }))).not.toBe(name);
    expect(sourceFileName(text('fixed', { boundaries: [8, 30] }, 'h2'))).not.toBe(name);
    expect(sourceFileName(text('pipes', {}))).not.toBe(sourceFileName(text('pipes', { header: false })));
    expect(sourceRelation(text('fixed', { boundaries: [8, 30] }))).toBe(`read_csv('${name}', header = true, delim = ',', quote = '"', escape = '"', null_padding = true)`);
  });

  it('applies the words for empty, with the empty cell always among them', () => {
    const source = text('pipes', { nullStrings: ['N/A', ''] });
    expect(sourceRelation(source)).toBe(`read_csv('${sourceFileName(source)}', header = true, delim = ',', quote = '"', escape = '"', null_padding = true, nullstr = ['', 'N/A'])`);
  });
});

describe('reading a file from an archive', () => {
  const inArchive = (format: Source['format'], archive: Source['archive'], parseOptions: Source['parseOptions'] = {}): Source => ({
    id: 'a',
    name: 'orders.csv',
    kind: 'file',
    format,
    file: { originalName: 'shop.zip', size: 1, lastModified: 0, headHash: 'h1' },
    archive,
    parseOptions,
    detectedSchema: [],
  });

  it('hands DuckDB a gzipped CSV, TSV or JSON as it is, named with its .gz, to unpack as it reads', () => {
    const gz = inArchive('csv', { kind: 'gzip', entry: 'orders.csv' });
    expect(sourceFileName(gz)).toMatch(/^src_a_[0-9a-f]{12}\.csv\.gz$/);
    expect(sourceRelation(gz)).toBe(`read_csv('${sourceFileName(gz)}', compression = 'gzip', null_padding = true)`);
    const json = inArchive('ndjson', { kind: 'gzip', entry: 'events.ndjson' });
    expect(sourceFileName(json)).toMatch(/\.ndjson\.gz$/);
    expect(sourceRelation(json)).toBe(`read_json_auto('${sourceFileName(json)}', format = 'newline_delimited', compression = 'gzip')`);
    expect(sourceRelation(inArchive('json', { kind: 'gzip', entry: 'items.json' }))).toMatch(/^read_json_auto\('src_a_[0-9a-f]{12}\.json\.gz', compression = 'gzip'\)$/);
  });

  it('reads an unpacked entry under a name that follows the entry, so another file of the same zip is never mistaken for it', () => {
    const orders = inArchive('csv', { kind: 'zip', entry: 'shop/orders.csv' });
    const customers = inArchive('csv', { kind: 'zip', entry: 'shop/customers.csv' });
    expect(sourceFileName(orders)).toMatch(/^src_a_[0-9a-f]{12}\.csv$/);
    expect(sourceFileName(orders)).not.toBe(sourceFileName(customers));
    expect(sourceRelation(orders)).toBe(`read_csv('${sourceFileName(orders)}', null_padding = true)`);
    // A gzipped workbook or Parquet file is unpacked first: no .gz.
    expect(sourceFileName(inArchive('parquet', { kind: 'gzip', entry: 'data.parquet' }))).toMatch(/\.parquet$/);
    expect(sourceTableName(inArchive('xlsx', { kind: 'gzip', entry: 'sales.xlsx' }))).not.toBe(sourceTableName(inArchive('xlsx', { kind: 'gzip', entry: 'other.xlsx' })));
    // The rewritten formats keep the entry in their names too.
    expect(sourceFileName(inArchive('pipes', { kind: 'zip', entry: 'a.txt' }))).not.toBe(sourceFileName(inArchive('pipes', { kind: 'zip', entry: 'b.txt' })));
  });

  it('reads an Arrow file as the table it was loaded into, named for the file', () => {
    const arrow: Source = { ...inArchive('arrow', undefined), name: 'customers.arrow', file: { originalName: 'customers.arrow', size: 1, lastModified: 0, headHash: 'h1' } };
    expect(sourceTableName(arrow)).toMatch(/^src_a_[0-9a-f]{12}$/);
    expect(sourceRelation(arrow)).toBe(`"${sourceTableName(arrow)}"`);
    expect(sourceTableName({ ...arrow, file: { ...arrow.file!, headHash: 'h2' } })).not.toBe(sourceTableName(arrow));
  });
});

describe('reading a log file', () => {
  const log: Source = { id: 'l', name: 'access.log', kind: 'file', format: 'log', file: { originalName: 'access.log', size: 1, lastModified: 0, headHash: 'h1' }, parseOptions: { preset: 'combined' }, detectedSchema: [] };

  it('reads the CSV Puddle wrote from the lines, named for the file, the preset and the pattern', () => {
    expect(sourceFileName(log)).toMatch(/^src_l_[0-9a-f]{12}\.csv$/);
    expect(sourceRelation(log)).toBe(`read_csv('${sourceFileName(log)}', header = true, delim = ',', quote = '"', escape = '"', null_padding = true)`);
    expect(sourceFileName({ ...log, parseOptions: { preset: 'syslog' } })).not.toBe(sourceFileName(log));
    expect(sourceFileName({ ...log, parseOptions: { preset: 'custom', pattern: '(?<a>.)' } })).not.toBe(sourceFileName({ ...log, parseOptions: { preset: 'custom', pattern: '(?<b>.)' } }));
  });
});

describe('reading a table of a Word document', () => {
  const word: Source = { id: 'w', name: 'report.docx', kind: 'file', format: 'word', file: { originalName: 'report.docx', size: 1, lastModified: 0, headHash: 'h1' }, parseOptions: {}, detectedSchema: [] };

  it('reads the CSV Puddle wrote from the table, named for the file, the table and the header option', () => {
    expect(sourceFileName(word)).toMatch(/^src_w_[0-9a-f]{12}\.csv$/);
    expect(sourceRelation(word)).toBe(`read_csv('${sourceFileName(word)}', header = true, delim = ',', quote = '"', escape = '"', null_padding = true)`);
    const other = { ...word, parseOptions: { table: '2' } };
    expect(sourceFileName(other)).not.toBe(sourceFileName(word));
    expect(sourceFileName({ ...word, parseOptions: { header: false } })).not.toBe(sourceFileName(word));
    expect(sourceFileName({ ...word, file: { ...word.file!, headHash: 'h2' } })).not.toBe(sourceFileName(word));
    expect(sourceRelation({ ...word, parseOptions: { nullStrings: ['n/a'] } })).toContain(`nullstr = ['', 'n/a']`);
  });

  it('reads a PDF’s table the same way, under a name of its own', () => {
    const pdf: Source = { ...word, format: 'pdf', name: 'statement.pdf' };
    expect(sourceFileName(pdf)).toMatch(/^src_w_[0-9a-f]{12}\.csv$/);
    expect(sourceFileName(pdf)).not.toBe(sourceFileName(word));
    expect(sourceRelation(pdf)).toBe(`read_csv('${sourceFileName(pdf)}', header = true, delim = ',', quote = '"', escape = '"', null_padding = true)`);
  });
});
