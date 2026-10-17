import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORMAT_VERSION } from '../model';
import { createTemplate } from '../templates/template';
import { MIGRATIONS, type Migration } from './migrate';
import { migrateTemplate, TemplateError, templateAsProject, templateFromProject } from './templates';

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '../../tests/fixtures/templates', name), 'utf8')) as Record<string, unknown>;

const tidy = () =>
  createTemplate({
    name: 'Tidy names',
    description: 'Trims names.',
    steps: [{ id: 'st1', type: 'trimWhitespace', label: 'Trimmed name', enabled: true, params: { columns: ['name'] } }],
    expectedColumns: [{ name: 'name', type: 'VARCHAR' }],
  });

describe('template migrations', () => {
  it('reads a current template back as it was saved', () => {
    const t = tidy();
    expect(migrateTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it('is a single-node project on the way through, and comes back unchanged', () => {
    const t = tidy();
    const p = templateAsProject(t);
    expect(p).toMatchObject({ name: 'Tidy names', notes: 'Trims names.', sources: [], edges: [], nodes: [{ type: 'transform', steps: t.steps }] });
    expect(templateFromProject(p)).toEqual(t);
  });

  it('upgrades a template written before formats were versioned (fixture)', () => {
    const t = migrateTemplate(fixture('unversioned.template.json'));
    expect(t.formatVersion).toBe(FORMAT_VERSION);
    expect(t.description).toBe('Trims and title-cases names, lower-cases emails.');
    expect(t.steps.map((s) => [s.type, s.enabled])).toEqual([
      ['trimWhitespace', true],
      ['changeCase', true],
    ]);
    expect(t.expectedColumns.map((c) => c.name)).toEqual(['name', 'email']);
  });

  it('runs the project migrations over its steps', () => {
    const seen: string[] = [];
    const migrations: Record<number, Migration> = {
      0: (p) => {
        seen.push(String(p.name));
        const nodes = (p.nodes as { steps: { label: string }[] }[]).map((n) => ({ ...n, steps: n.steps.map((s) => ({ ...s, label: `${s.label} (upgraded)` })) }));
        return MIGRATIONS[0]!({ ...p, nodes });
      },
    };
    const t = migrateTemplate(fixture('unversioned.template.json'), migrations);
    expect(seen).toEqual(['Tidy contact names']);
    expect(t.steps[0]!.label).toBe('Trimmed name, email (upgraded)');
  });

  it('refuses a template from a newer Puddle, with the reason', () => {
    expect(() => migrateTemplate({ ...tidy(), formatVersion: FORMAT_VERSION + 1 })).toThrow(/newer version of Puddle/);
  });

  it('says plainly when something is not a usable template', () => {
    expect(() => migrateTemplate('text')).toThrow(TemplateError);
    expect(() => migrateTemplate({ name: 'No steps' })).toThrow(/isn’t a Puddle template/);
    expect(() => migrateTemplate({ ...tidy(), formatVersion: 'one' })).toThrow(/unreadable format version/);
    expect(() => migrateTemplate({ ...tidy(), steps: [] })).toThrow(/damaged or incomplete/);
    expect(() => migrateTemplate({ ...tidy(), formatVersion: 0 }, {})).toThrow(/can’t upgrade templates from format 0/);
  });
});
