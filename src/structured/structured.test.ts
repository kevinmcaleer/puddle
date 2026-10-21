import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIni } from './ini';
import { candidateLabel, parseStructured, recordCandidates, structuredToTable, type StructuredFormat } from './index';

const fixture = (name: string) => readFileSync(join(__dirname, '../../tests/fixtures/structured', name), 'utf8');
const table = (format: StructuredFormat, name: string, record?: string) => structuredToTable(parseStructured(format, fixture(name)), format, { record });

describe('YAML', () => {
  it('reads the biggest list of records, flattening nested maps into dotted columns and keeping lists as JSON', () => {
    const t = table('yaml', 'servers.yaml');
    expect(t.record).toBe('servers');
    expect(t.columns).toEqual(['name', 'ip', 'cores', 'tags', 'added', 'owner.team', 'owner.email']);
    expect(t.rows).toEqual([
      ['alpha', '10.0.0.1', '4', '["web","prod"]', '2026-01-05', 'platform', 'platform@example.com'],
      ['beta', '10.0.0.2', '8', '[]', '2026-02-10', 'data', 'data@example.com'],
      ['gamma', '10.0.0.3', '2', '["batch"]', '', 'data', ''],
    ]);
    expect(t.candidates.map(candidateLabel)).toEqual(['servers (3 records)', 'The whole document, as one row']);
    // The whole document as one row: the list becomes JSON.
    const one = table('yaml', 'servers.yaml', '.');
    expect(one.columns).toEqual(['region', 'servers']);
    expect(one.rows[0]![1]).toMatch(/^\[\{"name":"alpha"/);
  });

  it('reads several documents as records, a top-level list as it is, and a scalar list as a value column', () => {
    expect(structuredToTable(parseStructured('yaml', 'a: 1\n---\na: 2\n'), 'yaml')).toMatchObject({ columns: ['a'], rows: [['1'], ['2']], record: '' });
    expect(structuredToTable(parseStructured('yaml', '- x: 1\n  y: true\n- x: 2\n  y: null\n'), 'yaml')).toMatchObject({ columns: ['x', 'y'], rows: [['1', 'true'], ['2', '']] });
    expect(structuredToTable(parseStructured('yaml', '- 1\n- 2\n'), 'yaml')).toMatchObject({ columns: ['value'], rows: [['1'], ['2']] });
    expect(() => parseStructured('yaml', 'a: [1, 2\n')).toThrow(/This isn’t YAML Puddle can read \(.+\)\. Check the file, or choose another format\./);
  });
});

describe('TOML', () => {
  it('reads an array of tables as records, offers the maps of tables as entries, and writes dates as ISO 8601', () => {
    const t = table('toml', 'pyproject.toml');
    expect(t.record).toBe('products');
    expect(t.columns).toEqual(['sku', 'price', 'in_stock']);
    expect(t.rows).toEqual([
      ['A-1', '12.5', 'true'],
      ['B-2', '8', 'false'],
    ]);
    expect(t.candidates.map(candidateLabel)).toEqual(['products (2 records)', 'servers (2 entries)', 'The whole document, as one row']);
    const servers = table('toml', 'pyproject.toml', 'servers');
    expect(servers.columns).toEqual(['key', 'ip', 'role']);
    expect(servers.rows).toEqual([
      ['alpha', '10.0.0.1', 'web'],
      ['beta', '10.0.0.2', 'db'],
    ]);
    expect(table('toml', 'pyproject.toml', '.').rows[0]!.slice(0, 3)).toEqual(['Example', 'Ada', '1979-05-27T07:32:00.000Z']);
  });
});

describe('INI', () => {
  it('parses sections, comments after values, quotes and dotted sections', () => {
    expect(parseIni(fixture('settings.ini'))).toEqual({
      app: 'Puddle',
      debug: 'false',
      database: { host: 'db.example.com', port: '5432', name: 'puddle' },
      cache: { host: 'cache.example.com', port: '6379', ttl: '300' },
    });
    expect(parseIni('[a.b]\nk = "x ; not a comment"\nflag\n')).toEqual({ a: { b: { k: 'x ; not a comment', flag: '' } } });
  });

  it('reads the sections as rows named by a key column', () => {
    const t = table('ini', 'settings.ini');
    expect(t.record).toBe('');
    expect(t.columns).toEqual(['key', 'host', 'port', 'name', 'ttl']);
    expect(t.rows).toEqual([
      ['database', 'db.example.com', '5432', 'puddle', ''],
      ['cache', 'cache.example.com', '6379', '', '300'],
    ]);
    // The keys above the sections (app, debug) are read with the whole document as one row.
    expect(t.candidates.map((c) => [c.path, c.kind])).toEqual([['', 'map'], ['.', 'one']]);
    expect(table('ini', 'settings.ini', '.')).toMatchObject({ columns: ['app', 'debug', 'database.host', 'database.port', 'database.name', 'cache.host', 'cache.port', 'cache.ttl'] });
  });
});

describe('GeoJSON', () => {
  it('reads each feature as its properties, its id and its geometry as JSON', () => {
    const t = table('geojson', 'places.geojson');
    expect(t.record).toBe('features');
    expect(t.columns).toEqual(['id', 'name', 'kind', 'height', 'geometry']);
    expect(t.rows).toEqual([
      ['1', 'Lighthouse', 'landmark', '34.5', '{"type":"Point","coordinates":[-3.1,53.4]}'],
      ['2', 'Pier', 'landmark', '', '{"type":"LineString","coordinates":[[-3.1,53.4],[-3.11,53.41]]}'],
      ['', 'Park', 'green', '2', ''],
    ]);
    const one = structuredToTable(parseStructured('geojson', '{"type":"Feature","properties":{"a":1},"geometry":{"type":"Point","coordinates":[0,0]}}'), 'geojson');
    expect(one).toMatchObject({ columns: ['a', 'geometry'], rows: [['1', '{"type":"Point","coordinates":[0,0]}']] });
  });
});

describe('record candidates', () => {
  it('prefers lists of records to maps, the biggest first, and looks inside the first record of a list', () => {
    const value = { meta: { a: { x: 1 }, b: { x: 2 } }, data: { items: [{ id: 1, parts: [{ p: 1 }, { p: 2 }, { p: 3 }] }, { id: 2 }] } };
    expect(recordCandidates(value).map((c) => [c.path, c.count, c.kind])).toEqual([
      ['data/items/parts', 3, 'list'],
      ['data/items', 2, 'list'],
      ['meta', 2, 'map'],
      ['.', 1, 'one'],
    ]);
    expect(structuredToTable(value, 'yaml', { record: 'data/items' }).rows.map((r) => r[0])).toEqual(['1', '2']);
    // A path that isn't there any more falls back to the likeliest.
    expect(structuredToTable(value, 'yaml', { record: 'gone' }).record).toBe('data/items/parts');
  });
});
