import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseProject } from '../model';
import { addressOf } from '../sources/url';
import { isSampleFile, isShippedFile, sampleAddress, sampleById, sampleProjectName, SAMPLES, TAXI_TUTORIAL, TAXI_TUTORIAL_PAGE } from './catalog';
import { guideAddress, sampleProject } from './open';

const shipped = readdirSync(join(__dirname, '../../public/samples')).sort();

describe('the sample catalogue', () => {
  it('names every file shipped in public/samples, and only those', () => {
    expect([...new Set(SAMPLES.flatMap((s) => s.files.map((f) => f.file)))].sort()).toEqual(shipped);
  });

  it('gives each sample a distinct id, a title, a blurb and a note that says what’s wrong and that it’s a sample', () => {
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
    for (const s of SAMPLES) {
      expect(s.title).toMatch(/^[A-Z][A-Za-z ]+$/);
      expect(s.blurb.length).toBeGreaterThan(10);
      expect(s.note).toContain('What’s wrong with it');
      expect(s.note).toContain('This is a sample project.');
    }
  });

  it('labels sample projects as samples', () => {
    expect(sampleProjectName(sampleById('orders')!)).toBe('Sample: orders and customers');
  });

  it('only treats files it ships as samples', () => {
    expect(isSampleFile('contacts.csv')).toBe(true);
    expect(isSampleFile('../index.html')).toBe(false);
    expect(isSampleFile('other.csv')).toBe(false);
    expect(isSampleFile(undefined)).toBe(false);
  });

  it('serves samples next to the app, wherever it is hosted', () => {
    expect(sampleAddress('sales.csv', 'https://puddle.example/').href).toBe('https://puddle.example/samples/sales.csv');
    expect(sampleAddress('sales.csv', 'http://192.168.1.5:8088/index.html').href).toBe('http://192.168.1.5:8088/samples/sales.csv');
  });
});

describe('sampleProject', () => {
  const at = new Date('2026-10-16T12:00:00Z');

  it('builds a valid project: one URL source per file, stacked down the canvas, the note, the first file viewed', () => {
    const p = sampleProject(sampleById('orders')!, 'https://puddle.example/', at);
    expect(parseProject(p)).toEqual(p);
    expect(p.name).toBe('Sample: orders and customers');
    expect(p.notes).toBe(sampleById('orders')!.note);
    expect(p.sources.map((s) => ({ name: s.name, kind: s.kind, format: s.format, url: s.url }))).toEqual([
      { name: 'orders.csv', kind: 'url', format: 'csv', url: { href: 'https://puddle.example/samples/orders.csv', sample: 'orders.csv' } },
      { name: 'customers.csv', kind: 'url', format: 'csv', url: { href: 'https://puddle.example/samples/customers.csv', sample: 'customers.csv' } },
    ]);
    expect(p.nodes.map((n) => [n.type, n.name, n.position])).toEqual([
      ['source', 'orders.csv', { x: 80, y: 80 }],
      ['source', 'customers.csv', { x: 80, y: 280 }],
    ]);
    expect(p.view.viewedNodeId).toBe(p.nodes[0]!.id);
  });

  it('makes a new project each time', () => {
    const sample = sampleById('contacts')!;
    expect(sampleProject(sample, 'https://a.example/', at).id).not.toBe(sampleProject(sample, 'https://a.example/', at).id);
  });
});

describe('addressOf', () => {
  it('reads a sample from beside the app as served now, whatever address the project recorded', () => {
    const [source] = sampleProject(sampleById('contacts')!, 'https://old.example/puddle/').sources;
    // No page here (Node): the recorded address's folder stands in for it.
    expect(String(addressOf(source!))).toBe('https://old.example/puddle/samples/contacts.csv');
    vi.stubGlobal('document', { baseURI: 'http://localhost:8088/' });
    try {
      expect(String(addressOf(source!))).toBe('http://localhost:8088/samples/contacts.csv');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads any other URL source, or a sample file Puddle doesn’t ship, from its address', () => {
    const href = 'https://data.example/sales.csv';
    expect(addressOf({ id: 's', name: 'x', kind: 'url', format: 'csv', url: { href }, parseOptions: {}, detectedSchema: [] })).toBe(href);
    expect(addressOf({ id: 's', name: 'x', kind: 'url', format: 'csv', url: { href, sample: '../secret.csv' }, parseOptions: {}, detectedSchema: [] })).toBe(href);
  });
});

describe('the taxi tutorial', () => {
  const at = new Date('2026-10-17T12:00:00Z');

  it('opens as a project with the trips and the zone lookup, read through Puddle’s server, not shipped', () => {
    const p = sampleProject(sampleById('taxi')!, 'https://puddle.example/', at);
    expect(parseProject(p)).toEqual(p);
    expect(p.name).toBe('Tutorial: three million taxi trips');
    expect(p.notes).toBe(TAXI_TUTORIAL.note);
    expect(p.sources.map((s) => ({ name: s.name, format: s.format, url: s.url }))).toEqual([
      {
        name: 'yellow_tripdata_2024-01.parquet',
        format: 'parquet',
        url: { href: 'https://puddle.example/tutorial-data/trip-data/yellow_tripdata_2024-01.parquet', sample: 'yellow_tripdata_2024-01.parquet' },
      },
      { name: 'taxi_zone_lookup.csv', format: 'csv', url: { href: 'https://puddle.example/tutorial-data/misc/taxi_zone_lookup.csv', sample: 'taxi_zone_lookup.csv' } },
    ]);
    expect(isSampleFile('taxi_zone_lookup.csv')).toBe(true);
    // Read like a typed address (by ranges, not cached), unlike the small files shipped with the app.
    expect(isShippedFile('taxi_zone_lookup.csv')).toBe(false);
    expect(isShippedFile('contacts.csv')).toBe(true);
  });

  it('reads its files from beside the app as served now', () => {
    const [trips] = sampleProject(TAXI_TUTORIAL, 'https://old.example/puddle/').sources;
    expect(String(addressOf(trips!))).toBe('https://old.example/puddle/tutorial-data/trip-data/yellow_tripdata_2024-01.parquet');
    vi.stubGlobal('document', { baseURI: 'http://192.168.1.5:8088/' });
    try {
      expect(String(addressOf(trips!))).toBe('http://192.168.1.5:8088/tutorial-data/trip-data/yellow_tripdata_2024-01.parquet');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('links its note to the tutorial’s page in the user guide, which exists', () => {
    expect(TAXI_TUTORIAL.note).toContain(`](${TAXI_TUTORIAL_PAGE})`);
    expect(TAXI_TUTORIAL_PAGE).toBe('docs/tutorial-taxi.html');
    expect(existsSync(join(__dirname, '../../docs/tutorial-taxi.md'))).toBe(true);
    expect(sampleAddress('yellow_tripdata_2024-01.parquet', 'https://puddle.example/').href).toBe('https://puddle.example/tutorial-data/trip-data/yellow_tripdata_2024-01.parquet');
  });

  it('finds the user guide beside the app', () => {
    expect(guideAddress('https://puddle.example/')).toBe('https://puddle.example/docs/');
    expect(guideAddress('http://192.168.1.5:8088/index.html')).toBe('http://192.168.1.5:8088/docs/');
  });
});
