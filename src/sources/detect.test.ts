import { ACCEPT, formatFromName, formatFromText, isArchiveName, knownFormat, SourceError, sourceName } from './detect';
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
    ['book.xls', 'xlsx'],
    ['book.xlsb', 'xlsx'],
    ['book.xlsm', 'xlsx'],
    ['customers.arrow', 'arrow'],
    ['servers.yaml', 'yaml'],
    ['servers.yml', 'yaml'],
    ['report.docx', 'word'],
    ['pyproject.toml', 'toml'],
    ['settings.ini', 'ini'],
    ['app.cfg', 'ini'],
    ['places.geojson', 'geojson'],
    ['places.kml', 'xml'],
    ['track.gpx', 'xml'],
    ['customers.feather', 'arrow'],
    ['orders.csv.gz', 'csv'],
    ['book.xlsx.gz', 'xlsx'],
    ['book.ods', 'xlsx'],
    ['book.fods', 'xlsx'],
    ['book.numbers', 'xlsx'],
    ['table.dbf', 'xlsx'],
    ['table.dif', 'xlsx'],
    ['table.slk', 'xlsx'],
    ['table.sylk', 'xlsx'],
    ['table.wk1', 'xlsx'],
    ['books.xml', 'xml'],
    ['shop.accdb', 'access'],
    ['SHOP.MDB', 'access'],
  ])('%s is %s', (name, format) => {
    expect(formatFromName(name)).toBe(format);
  });

  it('refuses unknown formats with what it can read', () => {
    expect(() => formatFromName('photo.png')).toThrow(/CSV, TSV, JSON, NDJSON, Parquet, Arrow, spreadsheet \(\.xlsx, \.xls, \.ods, \.numbers, \.dbf\), XML, YAML, TOML, INI, GeoJSON, Word \(\.docx\) or Access \(\.accdb, \.mdb\) file, or a \.gz or \.zip holding one/);
    expect(() => formatFromName('README')).toThrow(SourceError);
  });

  it('accepts exactly the extensions it can read in the file chooser', () => {
    // A .gz or .zip is opened for the file inside (src/sources/archive.ts), so its own name says no format.
    for (const ext of ACCEPT.split(',')) if (!isArchiveName(`f${ext}`)) expect(() => formatFromName(`f${ext}`)).not.toThrow();
    expect(ACCEPT.split(',').filter((ext) => isArchiveName(`f${ext}`))).toEqual(['.gz', '.zip']);
    expect(knownFormat('data.gz')).toBeUndefined();
    expect(isArchiveName('ORDERS.ZIP')).toBe(true);
    expect(isArchiveName('orders.tgz')).toBe(false);
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
