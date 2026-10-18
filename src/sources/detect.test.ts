import { ACCEPT, formatFromName, formatFromText, SourceError, sourceName } from './detect';
import { headHash } from './hash';

describe('format from a file name', () => {
  it.each([
    ['orders.csv', 'csv'],
    ['ORDERS.CSV', 'csv'],
    ['notes.txt', 'csv'],
    ['orders.tsv', 'tsv'],
    ['orders.tab', 'tsv'],
    ['items.json', 'json'],
    ['events.ndjson', 'ndjson'],
    ['events.jsonl', 'ndjson'],
    ['data.parquet', 'parquet'],
    ['data.pq', 'parquet'],
    ['book.xlsx', 'xlsx'],
    ['BOOK.XLSX', 'xlsx'],
    ['books.xml', 'xml'],
  ])('%s is %s', (name, format) => {
    expect(formatFromName(name)).toBe(format);
  });

  it('asks for old .xls workbooks to be saved as .xlsx or CSV', () => {
    expect(() => formatFromName('book.xls')).toThrow(SourceError);
    expect(() => formatFromName('book.xls')).toThrow('book.xls is in the old Excel format (.xls), which Puddle doesn’t read. Open it in Excel and save it as .xlsx or CSV, then add that.');
  });

  it('refuses unknown formats with what it can read', () => {
    expect(() => formatFromName('photo.png')).toThrow(/CSV, TSV, JSON, NDJSON, Parquet, Excel \(\.xlsx\) or XML file/);
    expect(() => formatFromName('README')).toThrow(SourceError);
  });

  it('accepts exactly the extensions it can read in the file chooser', () => {
    for (const ext of ACCEPT.split(',')) expect(() => formatFromName(`f${ext}`)).not.toThrow();
  });
});

describe('format from pasted text', () => {
  it.each([
    ['a,b\n1,2', 'csv'],
    ['a\tb\n1\t2', 'tsv'],
    ['  [{"a":1}]', 'json'],
    ['{"a":1}', 'json'],
    ['{"a":1}\n{"a":2}', 'ndjson'],
    ['{\n  "a": 1\n}', 'json'],
    ['<?xml version="1.0"?><a/>', 'xml'],
    ['\n  <rows><r a="1"/></rows>', 'xml'],
    ['<!-- note --><a/>', 'xml'],
    ['< 5,b\n1,2', 'csv'],
  ])('%j is %s', (text, format) => {
    expect(formatFromText(text)).toBe(format);
  });
});

it('names a source after its file', () => {
  expect(sourceName('orders.csv')).toBe('orders.csv');
  expect(sourceName('  ')).toBe('Untitled source');
});

describe('head hash', () => {
  it('is stable for the same bytes and ignores anything past the first megabyte', async () => {
    const mb = 1024 * 1024;
    const a = new Uint8Array(mb + 10).fill(7);
    const b = new Uint8Array(mb + 10).fill(7);
    b[mb + 5] = 9;
    expect(await headHash(new Blob([a]))).toBe(await headHash(new Blob([b])));
    b[0] = 1;
    expect(await headHash(new Blob([b]))).not.toBe(await headHash(new Blob([a])));
    expect(await headHash(new Blob([a]))).toMatch(/^[0-9a-f]{64}$/);
  });
});
