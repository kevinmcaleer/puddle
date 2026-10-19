import type { Source } from '../model';
import { compileAccessLoad, sourceRelation, sourceTableName } from './sources';

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
