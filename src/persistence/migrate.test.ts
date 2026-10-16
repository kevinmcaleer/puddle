import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, FORMAT_VERSION } from '../model';
import { migrate, projectFileName, ProjectFileError, readProjectFile, upgrade, writeProjectFile, type Migration } from './migrate';

const fixture = (name: string) => readFileSync(join(__dirname, '../../tests/fixtures/projects', name), 'utf8');

describe('project files', () => {
  it('round-trips a project through .puddle.json', () => {
    const p = createProject('Round trip');
    expect(readProjectFile(writeProjectFile(p))).toEqual(p);
  });

  it('keeps project notes and every kind of node note through .puddle.json, text exactly as written', () => {
    const notes = '# Orders\n\n<script>alert(1)</script> and [docs](https://duckdb.org)';
    const p = {
      ...createProject('Notes'),
      notes,
      sources: [{ id: 's1', name: 'a.csv', kind: 'clipboard' as const, clipboard: { text: 'a\n1' }, format: 'csv' as const, parseOptions: {}, detectedSchema: [] }],
      nodes: [
        { id: 'n1', type: 'source' as const, sourceId: 's1', name: 'a.csv', notes: 'Sent weekly by finance.', position: { x: 0, y: 0 }, rules: [] },
        { id: 'n2', type: 'transform' as const, name: 'Clean', notes: 'Drops test rows.', position: { x: 1, y: 0 }, rules: [], steps: [] },
        { id: 'n3', type: 'output' as const, name: 'Out', notes: '<b>for</b> the board', position: { x: 2, y: 0 }, rules: [], outputSpec: { format: 'csv' as const, options: {} } },
      ],
    };
    const back = readProjectFile(writeProjectFile(p));
    expect(back.notes).toBe(notes);
    expect(back.nodes.map((n) => n.notes)).toEqual(['Sent weekly by finance.', 'Drops test rows.', '<b>for</b> the board']);
  });

  it('opens a project written before files were versioned (fixture)', () => {
    const p = readProjectFile(fixture('unversioned.puddle.json'));
    expect(p.formatVersion).toBe(FORMAT_VERSION);
    expect(p.name).toBe('Customers clean-up (old format)');
    expect(p.edges[0]!.to.port).toBe(0);
    expect(p.sources[1]!.clipboard!.text).toContain('A1\t3');
    expect(p.view.canvasViewport).toEqual({ x: -20, y: 10, zoom: 1.25 });
    expect(p.settings.locale).toBe('en-GB');
  });

  it('keeps opening format 1 files (fixture)', () => {
    const p = readProjectFile(fixture('v1.puddle.json'));
    expect(p.settings).toEqual({ sampleThresholdRows: 1_000_000, locale: 'en-GB', defaultDateFormats: ['%d/%m/%Y'] });
    expect(p.nodes.map((n) => n.id)).toEqual(['nCust', 'nPaste', 'nOut']);
  });

  it('runs each migration in order up to the current version', () => {
    const seen: number[] = [];
    const migrations: Record<number, Migration> = {
      1: (p) => (seen.push(1), { ...p, name: `${String(p.name)} (2)` }),
      2: (p) => (seen.push(2), { ...p, notes: 'upgraded' }),
    };
    const v1 = { ...createProject('Old'), formatVersion: 1 };
    const p = upgrade(v1, migrations, 3);
    expect(seen).toEqual([1, 2]);
    expect(p).toMatchObject({ name: 'Old (2)', notes: 'upgraded', formatVersion: 3 });
  });

  it('refuses a project from a newer Puddle, with the reason', () => {
    expect(() => migrate({ ...createProject(), formatVersion: FORMAT_VERSION + 1 })).toThrow(/newer version of Puddle/);
  });

  it('says plainly when a file is not a project', () => {
    expect(() => readProjectFile('not json')).toThrow(ProjectFileError);
    expect(() => readProjectFile('[1, 2]')).toThrow(/isn’t a Puddle project/);
    expect(() => readProjectFile('{"formatVersion": "one"}')).toThrow(/unreadable format version/);
    expect(() => readProjectFile('{"formatVersion": 1, "name": "x"}')).toThrow(/damaged or incomplete/);
    expect(() => upgrade({ formatVersion: 0 }, {}, 1)).toThrow(/can’t upgrade projects from format 0/);
  });

  it('never writes file contents, only references', () => {
    const text = writeProjectFile(readProjectFile(fixture('v1.puddle.json')));
    expect(text).toContain('"headHash"');
    expect(text).not.toMatch(/Ada Lovelace/);
  });

  it('names the file after the project', () => {
    expect(projectFileName({ name: 'Orders clean-up' })).toBe('orders-clean-up.puddle.json');
    expect(projectFileName({ name: 'Café / 2026 report' })).toBe('cafe-2026-report.puddle.json');
    expect(projectFileName({ name: '***' })).toBe('project.puddle.json');
  });
});
