import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SourceError } from './detect';
import { archiveKindOf, columnNames, decodeHead, fixedWidthColumns, signatureOf, sniff, sniffDelimiter, sniffHeader, sniffPasted, sniffShape, sniffText } from './sniff';

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p)));
const messy = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/messy', name)));
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures', name)));
const file = (name: string, head: Uint8Array) => sniff({ name, head, size: head.length });

/** A zip whose first local header names `entry` (enough for the signature; nothing reads the data). */
const zip = (entry: string) => bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, entry.length, 0, 0, 0], entry);
/** An OLE file header followed by a stream name as its directory writes it, in UTF-16. */
const ole = (stream: string) => bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(24).fill(0)], [...stream].flatMap((ch) => [ch.charCodeAt(0), 0]));
/** A dBase header: version III, last updated 5 January 2026, two fields (a 65-byte header), 20-byte records. */
const dbf = () => bytes([0x03, 26, 1, 5, 4, 0, 0, 0, 65, 0, 20, 0, ...new Array(20).fill(0)]);
const formats = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/formats', name)));

describe('binary signatures', () => {
  it.each([
    ['xl/workbook.xml', 'xlsx'],
    ['xl/workbook.bin', 'xlsx'],
    ['mimetype', 'xlsx'],
    ['Index/Document.iwa', 'xlsx'],
    ['word/document.xml', 'word'],
    ['ppt/presentation.xml', 'powerpoint'],
    ['data/orders.csv', 'zip'],
  ])('a zip holding %s is %s', (entry, format) => {
    expect(signatureOf(zip(entry))).toBe(format);
  });

  it('tells an old Excel workbook from a Word or PowerPoint file by the streams in the OLE file', () => {
    expect(signatureOf(ole('Workbook'))).toBe('xlsx');
    expect(signatureOf(ole('Book'))).toBe('xlsx');
    expect(signatureOf(ole('WordDocument'))).toBe('doc');
    expect(signatureOf(ole('PowerPoint Document'))).toBe('powerpoint');
    expect(signatureOf(ole('SummaryInformation'))).toBe('ole');
  });

  it('knows a dBase table, a Lotus 1-2-3 sheet, SYLK and DIF as spreadsheets', () => {
    expect(signatureOf(dbf())).toBe('xlsx');
    // Not dBase: a month of 13, a header length that isn't 32n + 1.
    expect(signatureOf(bytes([0x03, 26, 13, 5, 4, 0, 0, 0, 65, 0, 20, 0, ...new Array(20).fill(0)]))).toBeUndefined();
    expect(signatureOf(bytes([0x03, 26, 1, 5, 4, 0, 0, 0, 64, 0, 20, 0, ...new Array(20).fill(0)]))).toBeUndefined();
    expect(signatureOf(bytes([0x00, 0x00, 0x02, 0x00, 0x06, 0x04, 0x06, 0x00]))).toBe('xlsx');
    expect(signatureOf(bytes('ID;PWXL;N;E\r\n'))).toBe('xlsx');
    expect(signatureOf(bytes('TABLE\r\n0,1\r\n"EXCEL"\r\n'))).toBe('xlsx');
    expect(signatureOf(bytes('TABLE,ROUND\n'))).toBeUndefined();
  });

  it.each(['sales.xls', 'sales-biff5.xls', 'sales.xlsb', 'sales.xlsm', 'sales.ods', 'sales.numbers', 'sales.dbf', 'sales.wk1', 'sales.slk', 'sales.dif'])('reads the %s fixture as a spreadsheet by its bytes', (name) => {
    expect(file(name, formats(name))).toMatchObject({ format: 'xlsx', confidence: 'sure' });
  });

  it('reads a flat OpenDocument file (.fods, XML) as a spreadsheet by its name', () => {
    expect(file('sales.fods', formats('sales.fods'))).toMatchObject({ format: 'xlsx' });
  });

  it('takes an old Office file whose streams are out of reach as a workbook when the name says so', () => {
    expect(file('book.xls', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toMatchObject({ format: 'xlsx', confidence: 'likely' });
  });

  it.each([
    [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'ole'],
    ['PAR1', 'parquet'],
    ['ARROW1', 'arrow'],
    ['SQLite format 3\0', 'sqlite'],
    [[0x00, 0x01, 0x00, 0x00, ...new TextEncoder().encode('Standard ACE DB')], 'access'],
    [[0x00, 0x01, 0x00, 0x00, ...new TextEncoder().encode('Standard Jet DB')], 'access'],
    [[0x1f, 0x8b, 0x08], 'gzip'],
    ['BZh91AY', 'bzip2'],
    [[0x28, 0xb5, 0x2f, 0xfd], 'zstd'],
    ['%PDF-1.7', 'pdf'],
    ['name,age\nAda,36\n', undefined],
  ])('%j is %s', (sig, format) => {
    expect(signatureOf(bytes(sig as never))).toBe(format);
  });

  it('reads the real fixtures: the workbooks, Parquet and both Access files', () => {
    expect(file('skewed.xlsx', messy('skewed.xlsx')).format).toBe('xlsx');
    expect(file('merged.xlsx', messy('merged.xlsx')).format).toBe('xlsx');
    expect(file('customers.parquet', fixture('customers.parquet'))).toMatchObject({ format: 'parquet', confidence: 'sure' });
    expect(file('shop.accdb', fixture('shop.accdb'))).toMatchObject({ format: 'access', confidence: 'sure' });
    expect(file('shop.mdb', fixture('shop.mdb').subarray(0, 4096)).format).toBe('access');
    expect(file('customers.arrow', fixture('archives/customers.arrow'))).toMatchObject({ format: 'arrow', confidence: 'sure', reason: 'An Arrow file by its signature.' });
    // An Arrow stream (no ARROW1 magic) is binary that only a known name explains.
    expect(() => file('customers.arrows', bytes([0xff, 0xff, 0xff, 0xff, 0x10, 0, 0, 0, 0x0c, 0, 0, 0]))).toThrow('customers.arrows is a binary file');
    expect(file('customers.feather', bytes([0xff, 0xff, 0xff, 0xff, 0x10, 0, 0, 0, 0x0c, 0, 0, 0]))).toMatchObject({ format: 'arrow', confidence: 'likely' });
  });

  it('refuses what it can name but not read, saying what it is and what to do', () => {
    expect(() => file('letter.doc', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toThrow('letter.doc is an old Office file that isn’t a workbook, which Puddle doesn’t read. Add a CSV, TSV, JSON, NDJSON, Parquet, Arrow, spreadsheet (.xlsx, .xls, .ods, .numbers, .dbf), XML, YAML, TOML, INI, GeoJSON, Word (.docx), PDF or Access (.accdb, .mdb) file, or a .gz or .zip holding one.');
    expect(() => file('letter.doc', ole('WordDocument'))).toThrow('letter.doc is an old Word document (.doc), which Puddle doesn’t read. Open it in Word and save it as a .docx file, then add that.');
    expect(file('report.docx', zip('word/document.xml'))).toMatchObject({ format: 'word', confidence: 'sure', reason: 'A Word document by its signature.' });
    expect(file('statement.pdf', bytes('%PDF-1.4\n%\xe2\xe3'))).toMatchObject({ format: 'pdf', confidence: 'sure', reason: 'A PDF by its signature.' });
    // A compressed file or an archive is opened by addFileSource for the file inside (src/sources/archive.ts); the sniff alone names it.
    expect(() => file('orders.csv.gz', bytes([0x1f, 0x8b, 0x08]))).toThrow('orders.csv.gz is a gzip-compressed file, which Puddle opens from a chosen file: unpack it and add the file inside, or choose the archive itself.');
    expect(() => file('orders.csv.bz2', bytes('BZh91AY'))).toThrow('orders.csv.bz2 is a bzip2-compressed file, which Puddle doesn’t open. Unpack it and add the file inside, or pack it as gzip or zip.');
    expect(archiveKindOf(bytes([0x1f, 0x8b, 0x08]))).toBe('gzip');
    expect(archiveKindOf(fixture('archives/shop.zip'))).toBe('zip');
    expect(archiveKindOf(fixture('sales.xlsx'))).toBeUndefined();
    expect(archiveKindOf(bytes('a,b\n1,2'))).toBeUndefined();
    expect(() => file('photo.png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toThrow('photo.png is a binary file, which Puddle doesn’t read. Add a CSV, TSV, JSON, NDJSON, Parquet, Arrow, spreadsheet (.xlsx, .xls, .ods, .numbers, .dbf), XML, YAML, TOML, INI, GeoJSON, Word (.docx), PDF or Access (.accdb, .mdb) file, or a .gz or .zip holding one.');
    expect(() => file('empty.dat', bytes(''))).toThrow(SourceError);
  });
});

describe('text encodings', () => {
  it('reads a UTF-8 BOM, UTF-16 by its BOM or its NUL bytes, and bytes that aren’t UTF-8 as latin-1', () => {
    expect(decodeHead(bytes([0xef, 0xbb, 0xbf], 'a,b\n'))).toEqual({ text: 'a,b\n', bom: true });
    expect(decodeHead(bytes([0xff, 0xfe], [0x61, 0, 0x2c, 0, 0x62, 0]))).toEqual({ text: 'a,b', encoding: 'utf-16', bom: true });
    expect(decodeHead(bytes([0xfe, 0xff], [0, 0x61, 0, 0x2c, 0, 0x62]))).toEqual({ text: 'a,b', encoding: 'utf-16', bom: true });
    const noBom = bytes(Array.from('name,city\nAda,Leeds\n').flatMap((c) => [c.charCodeAt(0), 0]));
    expect(decodeHead(noBom)).toMatchObject({ text: 'name,city\nAda,Leeds\n', encoding: 'utf-16', bom: false });
    expect(decodeHead(bytes('caf', [0xe9], ',1\n'))).toEqual({ text: 'café,1\n', encoding: 'latin-1', bom: false });
    expect(decodeHead(bytes('café,1\n'))).toEqual({ text: 'café,1\n', bom: false });
    expect(decodeHead(bytes('a', [0], 'b'))).toEqual({ binary: true });
    // A PNG's signature has a control byte in it, and no NUL yet.
    expect(decodeHead(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ binary: true });
  });

  it('a megabyte cut inside a character is still UTF-8', () => {
    const cut = bytes('x,café'.repeat(10)).subarray(0, 'x,café'.repeat(10).length - 1);
    expect(decodeHead(cut, false)).toMatchObject({ bom: false });
    expect('encoding' in decodeHead(cut, false)).toBe(false);
  });
});

describe('delimited text', () => {
  it('picks the delimiter whose count agrees across the most lines, and tells TSV from CSV', () => {
    expect(sniffDelimiter(['a,b,c', 'd,e,f', 'g,h,i'])).toEqual({ delimiter: ',', share: 1, fields: 3 });
    expect(sniffDelimiter(['a;b', 'c;d', 'e;f', 'g,h;i'])).toEqual({ delimiter: ';', share: 1, fields: 2 });
    expect(sniffDelimiter(['a\tb,c', 'd\te,f'])).toMatchObject({ delimiter: ',' });
    expect(sniffDelimiter(['one', 'two'])).toBeUndefined();
    // Commas inside quotes don't count.
    expect(sniffDelimiter(['name,notes', '"Ada, Countess",x', '"Bob",y'])).toEqual({ delimiter: ',', share: 1, fields: 2 });
    expect(sniffText('name\tcity\nAda\tLeeds\n')).toMatchObject({ format: 'tsv', confidence: 'sure', parseOptions: {} });
    expect(sniffText('name;city\nAda;Leeds\n')).toMatchObject({ format: 'csv', confidence: 'sure', parseOptions: { delimiter: ';' } });
    expect(sniffText('name,city\nAda,Leeds\n')).toMatchObject({ format: 'csv', confidence: 'sure', parseOptions: {} });
  });

  it('keeps a ragged row as a row: a header ending in a comma, or an unquoted comma in a value, skips nothing', () => {
    // Regression: the bank statement's header has one more field than its rows, and one description has a comma in it.
    const bank = sniffText(new TextDecoder().decode(fixture('bank-statement.csv')));
    expect(bank).toMatchObject({ format: 'csv', parseOptions: {} });
    expect(bank.reason).not.toContain('Skipped');
    const wide = sniffText('a,b\n1,2\n3,4,5\n6,7\n', 'a,b\n1,2\n3,4,5\n6,7\n');
    expect(wide.parseOptions).toEqual({});
  });

  it('counts a banner and comment lines above the header into the skip, and trailing narrower lines into the bottom skip', () => {
    const head = ['Report of things', '', '# made by hand', 'id,name,qty', '1,Ada,3', '2,Bob,4'];
    expect(sniffShape(head, undefined, ',', 3)).toEqual({ skip: 3, skipBottom: 0, notes: ['3 lines above the header (1 starting with #)'] });
    expect(sniffShape(['id,name', '1,Ada'], ['1,Ada', '2,Bob', '', 'Total: 2', 'End', ''], ',', 2)).toEqual({ skip: 0, skipBottom: 2, notes: ['2 lines after the table'] });
    // A comment prefix is only one when no line starting with it is a row of the table; dashes never are when they rule a pipe table.
    expect(sniffShape(['--id|name', '-------', '|a|b|', '|c|d|'], undefined, '|', 3)).toMatchObject({ skip: 2 });
    expect(sniffShape(['a,b', 'c,d'], ['c,d'], ',', 2)).toEqual({ skip: 0, skipBottom: 0, notes: [] });
  });

  it('names the columns from the header line as DuckDB would: trimmed, empties and repeats made distinct', () => {
    expect(columnNames('id, name ,,name,', ',', 5)).toEqual(['id', 'name', 'column2', 'name_1', 'column4']);
    expect(columnNames('|Doc. no.  |Vendor   |', '|', 4)).toEqual(['column0', 'Doc. no.', 'Vendor', 'column3']);
    expect(columnNames(undefined, ',', 3)).toEqual(['column0', 'column1', 'column2']);
    expect(columnNames('"a, b",c', ',', 2)).toEqual(['a, b', 'c']);
  });

  it('a skipped banner also names the columns, so DuckDB reads below it without its own detection', () => {
    const banner = sniffText('Sales report\n\nid,name,qty\n1,Ada,3\n2,Bob,4\n3,Cy,5\n');
    expect(banner.parseOptions).toEqual({ skip: 2, columns: ['id', 'name', 'qty'] });
    expect(banner.reason).toContain('Skipped: 2 lines above the header.');
    // With no header row below the banner, the columns are column0… and the first row is data.
    expect(sniffText('Figures\n1,Ada,36\n2,Bob,41\n3,Cy,29\n').parseOptions).toEqual({ header: false, skip: 1, columns: ['column0', 'column1', 'column2'] });
    expect(sniffText('id,name\n1,Ada\n2,Bob\n', 'id,name\n1,Ada\n2,Bob\nRows: 2\n').parseOptions).toEqual({ skipBottom: 1 });
  });

  it('says the first row is data when its numbers line up with the numbers below', () => {
    expect(sniffHeader(['1,Ada,36', '2,Bob,41', '3,Cy,29'], ',')).toBe(false);
    expect(sniffHeader(['id,name,age', '1,Ada,36', '2,Bob,41'], ',')).toBeUndefined();
    expect(sniffHeader(['a,b', 'c,d', 'e,f'], ',')).toBeUndefined();
    expect(sniffText('1,Ada,36\n2,Bob,41\n3,Cy,29\n').parseOptions).toEqual({ header: false });
  });

  it('reads a pipe table or SAP list as a pipe table, fixed-width text with its boundaries, and YAML, TOML and INI by their lines', () => {
    expect(sniffText('|a|b|\n|---|---|\n|1|2|\n')).toMatchObject({ format: 'pipes', confidence: 'likely', parseOptions: {} });
    expect(sniffText('Title\n|a|b|\n|1|2|\n|3|4|\n')).toMatchObject({ format: 'pipes', reason: expect.stringContaining('1 line around the table') });
    const fixed = ['NAME      CITY     AGE', 'Ada       Leeds     36', 'Bob       York      41', 'Cy        Hull      29', 'Dee       Bath      33'];
    expect(fixedWidthColumns(fixed)).toBe(2);
    expect(sniffText(fixed.join('\n'))).toMatchObject({ format: 'fixed', confidence: 'likely', parseOptions: { boundaries: [10, 19] }, reason: '3 columns at fixed positions, lined up with spaces.' });
    expect(sniffText('---\nname: Ada\ncity: Leeds\n')).toMatchObject({ format: 'yaml', confidence: 'likely', reason: 'Key: value lines, as YAML has them.' });
    expect(sniffText('servers:\n  - name: alpha\n    ip: 10.0.0.1\n  - name: beta\n')).toMatchObject({ format: 'yaml', confidence: 'likely' });
    expect(sniffText('; settings\napp = Puddle\n[database]\nhost = db.example.com\nport = 5432\n')).toMatchObject({ format: 'ini', confidence: 'likely', reason: 'Key = value lines under [section] headings, as an INI file has them.' });
    expect(sniffText('title = "Example"\n[owner]\nname = "Ada"\n[[products]]\nsku = "A-1"\n')).toMatchObject({ format: 'toml', confidence: 'likely' });
    // The name settles TOML against INI, and a file named for one of them is sure.
    expect(file('settings.ini', bytes('[a]\nk = "v"\n'))).toMatchObject({ format: 'ini', confidence: 'sure' });
    expect(file('config.toml', bytes('[a]\nk = v\n'))).toMatchObject({ format: 'toml', confidence: 'sure' });
    expect(file('servers.yaml', fixture('structured/servers.yaml'))).toMatchObject({ format: 'yaml', confidence: 'sure' });
    expect(file('places.geojson', fixture('structured/places.geojson'))).toMatchObject({ format: 'geojson', confidence: 'sure', reason: 'A GeoJSON feature collection.' });
    expect(file('places.kml', fixture('structured/places.kml'))).toMatchObject({ format: 'xml', confidence: 'sure' });
    expect(sniffText('Dear all,\n\nHere are the notes.\nThanks.\n')).toMatchObject({ format: 'csv', confidence: 'unsure' });
  });

  it('tells JSON, NDJSON, XML and a web page apart', () => {
    expect(sniffText('[{"a":1}]')).toMatchObject({ format: 'json', confidence: 'sure' });
    expect(sniffText('{"a":1}\n{"a":2}\n')).toMatchObject({ format: 'ndjson', confidence: 'sure' });
    expect(sniffText('{\n  "a": 1\n}\n')).toMatchObject({ format: 'json', confidence: 'sure' });
    expect(sniffText('<?xml version="1.0"?><rows><row/></rows>')).toMatchObject({ format: 'xml', confidence: 'sure' });
    expect(sniffText('<!DOCTYPE html><html><body><table></table></body></html>')).toMatchObject({ format: 'xml', confidence: 'unsure', reason: expect.stringContaining('web page') });
    expect(sniffPasted('a\tb\n1\t2\n').format).toBe('tsv');
  });
});

describe('log files', () => {
  const read = (name: string) => readFileSync(join(__dirname, '../../tests/fixtures/logs', name), 'utf8');

  it('names the preset from the lines: an access log, syslog, an IIS log and a timestamped app log', () => {
    expect(file('access.log', bytes(read('access.log')))).toMatchObject({ format: 'log', confidence: 'likely', parseOptions: { preset: 'combined' }, reason: 'Lines in the shape of a web server access log (Web server access log (Apache, nginx)).' });
    expect(file('messages', bytes(read('syslog.log')))).toMatchObject({ format: 'log', parseOptions: { preset: 'syslog' } });
    expect(file('u_ex261011.log', bytes(read('iis.log')))).toMatchObject({ format: 'log', parseOptions: { preset: 'iis' } });
    expect(file('app.log', bytes(read('app.log')))).toMatchObject({ format: 'log', parseOptions: { preset: 'timestamped' } });
  });

  it('leaves a CSV or TSV log to DuckDB, timestamps and all', () => {
    expect(file('events.log', bytes('time,level,message\n2026-10-11 09:00:01,INFO,started\n2026-10-11 09:00:02,WARN,slow\n'))).toMatchObject({ format: 'csv' });
    expect(file('events.log', bytes('time\tlevel\tmessage\n2026-10-11 09:00:01\tINFO\tstarted\n2026-10-11 09:00:02\tWARN\tslow\n'))).toMatchObject({ format: 'tsv' });
  });
});

describe('the file name and the content', () => {
  it('agrees: a CSV named .csv is sure; a CSV named .txt or with no extension reads as CSV without a question', () => {
    expect(file('orders.csv', bytes('a,b\n1,2\n3,4\n'))).toMatchObject({ format: 'csv', confidence: 'sure' });
    expect(file('orders.txt', bytes('a;b\n1;2\n3;4\n'))).toMatchObject({ format: 'csv', confidence: 'sure', parseOptions: { delimiter: ';' } });
    expect(file('README', bytes('a,b\n1,2\n3,4\n'))).toMatchObject({ format: 'csv', confidence: 'sure' });
    expect(file('orders.txt', bytes('a\tb\n1\t2\n'))).toMatchObject({ format: 'tsv', confidence: 'sure' });
  });

  it('lets unambiguous content win over the name (D24): JSON named .csv reads as JSON', () => {
    expect(file('items.csv', bytes('[{"a":1}]'))).toMatchObject({ format: 'json', confidence: 'sure', alternatives: ['csv'] });
    expect(file('rows.json', bytes('a,b\n1,2\n3,4\n'))).toMatchObject({ format: 'csv', confidence: 'sure', alternatives: ['json'] });
  });

  it('asks when neither is sure, and takes the name’s word when the content says nothing', () => {
    expect(file('notes.txt', bytes('Dear all,\n\nHere are the notes.\n'))).toMatchObject({ format: 'csv', confidence: 'unsure' });
    expect(file('notes.csv', bytes('one\ntwo\nthree\n'))).toMatchObject({ format: 'csv', confidence: 'likely' });
    expect(file('list.json', bytes('|a|b|\n|--|--|\n|1|2|\n'))).toMatchObject({ format: 'pipes', confidence: 'unsure', alternatives: ['json'] });
  });

  it('sets the encoding from the bytes, and keeps a UTF-16 CSV as CSV', () => {
    const utf16 = bytes([0xff, 0xfe], Array.from('a,b\n1,2\n3,4\n').flatMap((c) => [c.charCodeAt(0), 0]));
    expect(file('orders.csv', utf16)).toMatchObject({ format: 'csv', confidence: 'sure', parseOptions: { encoding: 'utf-16' } });
    expect(file('orders.csv', bytes('caf', [0xe9], ',1\nth', [0xe9], ',2\n'))).toMatchObject({ parseOptions: { encoding: 'latin-1' } });
  });

  it('reads the messy fixtures: the SAP extract as a pipe table in latin-1, the CRM export as semicolons', () => {
    expect(file('sap-extract.txt', messy('sap-extract.txt'))).toMatchObject({ format: 'pipes', confidence: 'likely', parseOptions: { encoding: 'latin-1' } });
    expect(file('messy.txt', messy('messy.txt'))).toMatchObject({ format: 'csv', parseOptions: { delimiter: ';' } });
    expect(file('messy.csv', fixture('messy.csv'))).toMatchObject({ format: 'csv', confidence: 'sure', parseOptions: {} });
    expect(file('bond-films.html', fixture('bond-films.html'))).toMatchObject({ format: 'xml', confidence: 'unsure' });
  });
});
