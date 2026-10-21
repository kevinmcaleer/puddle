// YAML, TOML, INI and GeoJSON (#193) on real DuckDB-WASM through the rewrite path, and KML and GPX through the XML
// reader: each fixture under tests/fixtures/structured/ opens to the right rows, typed by DuckDB.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, setParseOptions, useProjectStore, type Project } from '../../src/model';
import { addClipboardSource, addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { resetRewrites, rewriteReady, syncRewrites, useRewrites } from '../../src/sources/rewrite';
import { resetXmlSources, syncXmlSources } from '../../src/sources/xml';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new File([readFileSync(join(__dirname, '../fixtures/structured', name)) as Uint8Array<ArrayBuffer>], name);

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  resetRewrites();
  resetXmlSources();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Structured'));
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const sync = () => syncRewrites(engine, project());

describe('structured text', () => {
  it('reads a YAML list of records with dotted columns, typed by DuckDB, and switches to the whole document', async () => {
    const s = await addFileSource(fixture('servers.yaml'));
    expect(s).toMatchObject({ format: 'yaml', parseOptions: {} });
    expect(rewriteReady(project(), s.id)).toBe(false);
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'ok', rows: 3, columns: 7, record: 'servers' });
    expect(await types(s.id)).toEqual(['name VARCHAR', 'ip VARCHAR', 'cores BIGINT', 'tags VARCHAR', 'added DATE', 'owner.team VARCHAR', 'owner.email VARCHAR']);
    expect((await rows(s.id))[2]).toEqual({ name: 'gamma', ip: '10.0.0.3', cores: 2, tags: '["batch"]', added: null, 'owner.team': 'data', 'owner.email': null });
    useProjectStore.getState().apply((p) => setParseOptions(p, s.id, { record: '.' }));
    await sync();
    expect(await rows(s.id)).toEqual([{ region: 'eu-west', servers: expect.stringMatching(/^\[\{"name":"alpha"/) }]);
  });

  it('reads a TOML array of tables, its map of tables by key, and an INI file’s sections', async () => {
    const t = await addFileSource(fixture('pyproject.toml'));
    const i = await addFileSource(fixture('settings.ini'));
    expect([t.format, i.format]).toEqual(['toml', 'ini']);
    await sync();
    expect(await types(t.id)).toEqual(['sku VARCHAR', 'price DOUBLE', 'in_stock BOOLEAN']);
    useProjectStore.getState().apply((p) => setParseOptions(p, t.id, { record: 'servers' }));
    await sync();
    expect(await rows(t.id)).toEqual([
      { key: 'alpha', ip: '10.0.0.1', role: 'web' },
      { key: 'beta', ip: '10.0.0.2', role: 'db' },
    ]);
    expect(await types(i.id)).toEqual(['key VARCHAR', 'host VARCHAR', 'port BIGINT', 'name VARCHAR', 'ttl BIGINT']);
    expect((await rows(i.id))[1]).toEqual({ key: 'cache', host: 'cache.example.com', port: 6379, name: null, ttl: 300 });
  });

  it('reads GeoJSON features as rows with their geometry as JSON, and pasted YAML too', async () => {
    const g = await addFileSource(fixture('places.geojson'));
    expect(g.format).toBe('geojson');
    const y = await addClipboardSource('- name: Ada\n  age: 36\n- name: Bob\n  age: 41\n');
    expect(y.format).toBe('yaml');
    await sync();
    expect(await types(g.id)).toEqual(['id BIGINT', 'name VARCHAR', 'kind VARCHAR', 'height DOUBLE', 'geometry VARCHAR']);
    expect((await rows(g.id))[0]).toEqual({ id: 1, name: 'Lighthouse', kind: 'landmark', height: 34.5, geometry: '{"type":"Point","coordinates":[-3.1,53.4]}' });
    expect(await rows(y.id)).toEqual([
      { name: 'Ada', age: 36 },
      { name: 'Bob', age: 41 },
    ]);
  });

  it('says what is wrong with YAML that doesn’t parse', async () => {
    const s = await addFileSource(new File([new TextEncoder().encode('a: [1, 2\nb: 3\n')], 'broken.yaml'));
    expect(s.format).toBe('yaml');
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'failed', message: expect.stringContaining('This isn’t YAML Puddle can read') });
  });
});

describe('KML and GPX', () => {
  it('read through the XML reader as placemarks and track points', async () => {
    const k = await addFileSource(fixture('places.kml'));
    const g = await addFileSource(fixture('track.gpx'));
    expect([k.format, g.format]).toEqual(['xml', 'xml']);
    await syncXmlSources(engine, project());
    expect(await types(k.id)).toEqual(['name VARCHAR', 'description VARCHAR', 'Point.coordinates VARCHAR']);
    expect((await rows(k.id)).map((r) => r.name)).toEqual(['Lighthouse', 'Pier']);
    expect(await types(g.id)).toEqual(['lat DOUBLE', 'lon DOUBLE', 'ele BIGINT', 'time TIMESTAMP WITH TIME ZONE']);
    expect((await rows(g.id)).length).toBe(4);
  });
});
