import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stepDef, stepParams, ruleParams } from '../compiler';
import { createProject, FORMAT_VERSION, parseProject, type Project, type Step } from '../model';
import { migrateTemplate } from '../persistence/templates';
import { createTemplate } from '../templates/template';
import { parseRecipe, projectFromRecipe, readRecipe, recipeFileName, recipeFromProject, recipeFromTemplate, RecipeError, RECIPE_VERSION, shareableHref, writeRecipe, type Recipe } from './recipe';

const at = new Date('2026-10-01T00:00:00Z');
const step = (id: string, type: string, params: Record<string, unknown>): Step => ({ id, type, label: `${type} ${id}`, enabled: true, params });

/** A project carrying every kind of data and secret a recipe must leave behind. */
function sensitive(): Project {
  const base = createProject('Payroll clean-up', at);
  return parseProject({
    ...base,
    notes: 'How we tidy the payroll export.',
    sources: [
      {
        id: 's_file',
        name: 'Payroll',
        kind: 'file',
        format: 'csv',
        file: { originalName: 'acme-payroll-2026-SECRET.csv', size: 123456, lastModified: 1767225600000, headHash: 'HEADHASH-FILE-0f0f', fsHandleRef: 'HANDLE-REF-1' },
        parseOptions: { delimiter: ';', header: true },
        detectedSchema: [
          { name: 'employee', type: 'VARCHAR' },
          { name: 'salary', type: 'DOUBLE' },
        ],
        sampleRows: 1000,
      },
      {
        id: 's_url',
        name: 'Rates',
        kind: 'url',
        format: 'csv',
        url: { href: 'https://alice:hunter2@example.com/data/rates.csv?token=SECRET-TOKEN&x=1#frag-SECRET', headers: { Authorization: 'Bearer SECRET-BEARER' }, headHash: 'HEADHASH-URL-abab', size: 99 },
        parseOptions: {},
        detectedSchema: [{ name: 'rate', type: 'DOUBLE' }],
      },
      { id: 's_paste', name: 'Pasted data', kind: 'clipboard', format: 'csv', clipboard: { text: 'employee,bonus\nRowValueAlice,ROWVALUE-1000\n' }, parseOptions: {}, detectedSchema: [{ name: 'employee', type: 'VARCHAR' }] },
    ],
    nodes: [
      { id: 'n_file', type: 'source', name: 'Payroll', sourceId: 's_file', position: { x: 0, y: 0 } },
      { id: 'n_url', type: 'source', name: 'Rates', sourceId: 's_url', position: { x: 0, y: 200 } },
      { id: 'n_paste', type: 'source', name: 'Pasted data', sourceId: 's_paste', position: { x: 0, y: 400 } },
      {
        id: 't',
        type: 'transform',
        name: 'Tidy',
        notes: 'Node notes travel.',
        pinnedResult: true,
        rules: [{ id: 'r1', type: 'notEmpty', label: 'employee is never empty', params: { column: 'employee' } }],
        steps: [
          step('a', 'trimWhitespace', { columns: ['employee'] }),
          step('b', 'pivot', { rows: ['employee'], column: 'month', pivotValues: ['PIVOTVALUE-Jan', 'PIVOTVALUE-Feb'], moreValues: true, values: [{ column: 'salary', agg: 'sum' }], names: { 'PIVOTVALUE-Jan sum of salary': 'January' } }),
          step('c', 'transpose', { columns: ['employee', 'salary'], rowCount: 2, headerValues: ['HEADERVALUE-Ann', 'HEADERVALUE-Bo'], headers: true }),
        ],
      },
      { id: 'o', type: 'output', name: 'Out', outputSpec: { format: 'csv', fileName: 'OUTPUT-FILENAME-SECRET.csv', options: { delimiter: ',' } } },
    ],
    edges: [
      { id: 'e1', from: { nodeId: 'n_file' }, to: { nodeId: 't', port: 0 } },
      { id: 'e2', from: { nodeId: 't' }, to: { nodeId: 'o', port: 0 } },
    ],
    view: { viewedNodeId: 't', pinned: true, canvasViewport: { x: 1, y: 2, zoom: 1 } },
    exportLog: [{ id: 'x1', at: '2026-09-01T00:00:00Z', nodeId: 'o', nodeName: 'Out', format: 'csv', fileName: 'EXPORTLOG-FILENAME.csv', rows: 42 }],
  });
}

const pipeline = (r: Recipe) => {
  if (r.kind !== 'pipeline') throw new Error('expected a pipeline recipe');
  return r;
};

describe('exporting a recipe', () => {
  const text = writeRecipe(recipeFromProject(sensitive(), { name: 'Payroll recipe', description: 'Tidies a payroll export.' }));

  it('contains no row values, file contents, file names, head hashes, kept results or secrets', () => {
    for (const secret of [
      'acme-payroll',
      'SECRET',
      'HEADHASH',
      'HANDLE-REF',
      'hunter2',
      'alice',
      'token',
      'frag',
      'RowValueAlice',
      'ROWVALUE',
      'PIVOTVALUE',
      'HEADERVALUE',
      'EXPORTLOG',
      'OUTPUT-FILENAME',
      '123456',
      '1767225600000',
      'pinnedResult',
      'sampleRows',
      'exportLog',
      'viewedNodeId',
      '"clipboard"',
      '"file":',
      'headHash',
      'originalName',
      'lastModified',
      '"size"',
    ])
      expect(text).not.toContain(secret);
  });

  it('keeps the pipeline: labels, formats, read options, expected columns, steps, rules, notes and wiring', () => {
    const raw = JSON.parse(text);
    expect(raw).toMatchObject({ puddleRecipe: RECIPE_VERSION, kind: 'pipeline', formatVersion: FORMAT_VERSION, name: 'Payroll recipe', description: 'Tidies a payroll export.', notes: 'How we tidy the payroll export.' });
    expect(raw.sources[0]).toEqual({ id: 's_file', name: 'Payroll', kind: 'file', format: 'csv', parseOptions: { delimiter: ';', header: true }, detectedSchema: [{ name: 'employee', type: 'VARCHAR' }, { name: 'salary', type: 'DOUBLE' }] });
    // The address keeps its host and path; header names stay so whoever opens it knows what to fill in.
    expect(raw.sources[1].url).toEqual({ href: 'https://example.com/data/rates.csv', headers: { Authorization: '' } });
    // Pasted rows don't travel: the source asks for a file.
    expect(raw.sources[2]).toMatchObject({ kind: 'file', name: 'Pasted data', detectedSchema: [{ name: 'employee', type: 'VARCHAR' }] });
    const t = raw.nodes.find((n: { id: string }) => n.id === 't');
    expect(t.notes).toBe('Node notes travel.');
    expect(t.rules).toHaveLength(1);
    expect(t.steps.map((s: Step) => s.type)).toEqual(['trimWhitespace', 'pivot', 'transpose']);
    expect(t.steps[1].params).toMatchObject({ rows: ['employee'], column: 'month', pivotValues: [], moreValues: false, names: {} });
    expect(t.steps[2].params).toMatchObject({ columns: ['employee', 'salary'], rowCount: 0, headerValues: [], headers: true });
    expect(raw.nodes.find((n: { id: string }) => n.id === 'o').outputSpec).toEqual({ format: 'csv', options: { delimiter: ',' } });
    expect(raw.edges).toHaveLength(2);
  });

  it('leaves out an address that can’t be read rather than guessing', () => {
    expect(shareableHref('not a url')).toBe('');
    expect(shareableHref('https://example.com/a.csv')).toBe('https://example.com/a.csv');
    const p = sensitive();
    const broken = { ...p, sources: p.sources.map((s) => (s.url ? { ...s, url: { href: 'not a url' } } : s)) };
    expect(recipeFromProject(broken, { name: '', description: '' }).sources[1]).toMatchObject({ kind: 'file' });
  });

  it('keeps which table a web page source reads, so the recipe reads the same one', () => {
    const p = sensitive();
    const web = { ...p, sources: p.sources.map((s) => (s.url ? { ...s, url: { href: 'https://en.wikipedia.org/wiki/List_of_James_Bond_films', headHash: 'x', table: { index: 1, label: 'Eon Productions films' } } } : s)) };
    expect(recipeFromProject(web, { name: '', description: '' }).sources[1]!.url).toEqual({ href: 'https://en.wikipedia.org/wiki/List_of_James_Bond_films', table: { index: 1, label: 'Eon Productions films' } });
  });

  it('keeps which entity set an OData source reads, and its query, so the recipe reads the same', () => {
    const p = sensitive();
    const odata = { entitySet: 'People', version: 4 as const, filter: 'Age gt 30', columns: [{ name: 'UserName', type: 'VARCHAR' }], auth: 'basic' as const };
    const feed = { ...p, sources: p.sources.map((s) => (s.url ? { ...s, url: { href: 'https://services.odata.org/TripPinRESTierService', headHash: 'x', odata } } : s)) };
    expect(recipeFromProject(feed, { name: '', description: '' }).sources[1]!.url).toEqual({ href: 'https://services.odata.org/TripPinRESTierService', odata });
  });

  it('names the file after the recipe', () => {
    expect(recipeFileName('Tidy a contact list!')).toBe('tidy-a-contact-list.puddle-recipe.json');
    expect(recipeFileName('  ')).toBe('recipe.puddle-recipe.json');
  });
});

describe('opening a recipe', () => {
  const text = writeRecipe(recipeFromProject(sensitive(), { name: 'Payroll recipe', description: 'Tidies a payroll export.' }));

  it('creates a new project whose sources wait for files and expect the recipe’s columns', () => {
    const p = projectFromRecipe(pipeline(readRecipe(text, at)), at);
    expect(p.name).toBe('Payroll recipe');
    expect(p.id).not.toBe('recipe');
    expect(p.nodes.map((n) => n.id)).toEqual(['n_file', 'n_url', 'n_paste', 't', 'o']);
    expect(p.sources.every((s) => !s.file && !s.clipboard)).toBe(true);
    // Fresh source ids, still read by their Source nodes.
    expect(p.sources.map((s) => s.id)).not.toContain('s_file');
    expect(p.nodes.filter((n) => n.type === 'source').map((n) => (n.type === 'source' ? n.sourceId : ''))).toEqual(p.sources.map((s) => s.id));
    expect(projectFromRecipe(pipeline(readRecipe(text, at)), at).sources[0]!.id).not.toBe(p.sources[0]!.id);
    expect(p.sources[0]!.expected).toEqual([{ name: 'employee', type: 'VARCHAR' }, { name: 'salary', type: 'DOUBLE' }]);
    expect(p.view.viewedNodeId).toBeUndefined();
    expect(p.exportLog).toEqual([]);
  });

  it('uses the description as notes when the recipe has none', () => {
    const raw = { ...JSON.parse(text), notes: '' };
    expect(projectFromRecipe(pipeline(parseRecipe(raw, at)), at).notes).toBe('Tidies a payroll export.');
  });

  it('drops data a hand-made recipe smuggles in', () => {
    const raw = JSON.parse(text);
    raw.sources[0].file = { originalName: 'smuggled.csv', size: 1, lastModified: 1, headHash: 'SMUGGLED' };
    raw.sources[2] = { ...raw.sources[2], kind: 'clipboard', clipboard: { text: 'a\nSMUGGLED' } };
    const opened = JSON.stringify(projectFromRecipe(pipeline(parseRecipe(raw, at)), at));
    expect(opened).not.toContain('SMUGGLED');
    expect(opened).not.toContain('smuggled');
  });

  it('refuses a recipe from a newer Puddle, a newer project format, or with unknown types, with a reason', () => {
    const raw = JSON.parse(text);
    const refusal = (r: unknown) => {
      try {
        parseRecipe(r, at);
      } catch (e) {
        expect(e).toBeInstanceOf(RecipeError);
        return (e as Error).message;
      }
      throw new Error('expected a refusal');
    };
    expect(refusal({ ...raw, puddleRecipe: RECIPE_VERSION + 1 })).toMatch(/newer version of Puddle/);
    expect(refusal({ ...raw, formatVersion: FORMAT_VERSION + 1 })).toMatch(/newer version of Puddle/);
    const withStep = structuredClone(raw);
    withStep.nodes[3].steps.push(step('z', 'teleportRows', {}));
    expect(refusal(withStep)).toMatch(/a step \(“teleportRows”\).*Update Puddle/);
    const withNode = structuredClone(raw);
    withNode.nodes.push({ id: 'w', type: 'wormhole', name: 'W' });
    expect(refusal(withNode)).toMatch(/a kind of node \(“wormhole”\)/);
    const withRule = structuredClone(raw);
    withRule.nodes[3].rules.push({ id: 'r9', type: 'isPrime', label: 'x', params: {} });
    expect(refusal(withRule)).toMatch(/a rule \(“isPrime”\)/);
    expect(refusal({ ...raw, puddleRecipe: 'one' })).toMatch(/unreadable version/);
    expect(refusal({ ...raw, nodes: 'broken' })).toMatch(/damaged or incomplete/);
    expect(refusal({ id: 'p', nodes: [], formatVersion: 1 })).toMatch(/project, not a recipe/);
    expect(refusal({ hello: 'world' })).toMatch(/isn’t a Puddle recipe/);
    expect(refusal({ ...raw, kind: 'cookbook' })).toMatch(/isn’t a Puddle recipe/);
    expect(() => readRecipe('{ nope', at)).toThrow(/isn’t valid JSON/);
  });

  it('upgrades a recipe written before formats were versioned', () => {
    const { formatVersion: _, ...unversioned } = JSON.parse(text);
    expect(pipeline(parseRecipe(unversioned, at)).project.nodes).toHaveLength(5);
  });
});

describe('templates as single-node recipes', () => {
  const template = createTemplate(
    {
      name: 'Tidy names',
      description: 'Trims and title-cases names.',
      steps: [step('a', 'trimWhitespace', { columns: ['name'] }), step('b', 'pivot', { rows: ['name'], column: 'city', pivotValues: ['PIVOTVALUE-Leeds'], values: [{ column: 'n', agg: 'count' }] })],
      expectedColumns: [{ name: 'name', type: 'VARCHAR' }],
    },
    at,
  );

  it('exports in the shape templates migrate in, without row values', () => {
    const text = writeRecipe(recipeFromTemplate(template));
    const raw = JSON.parse(text);
    expect(raw).toMatchObject({ puddleRecipe: RECIPE_VERSION, kind: 'template', name: 'Tidy names', description: 'Trims and title-cases names.', sources: [], edges: [], expectedColumns: [{ name: 'name', type: 'VARCHAR' }] });
    expect(raw.nodes).toHaveLength(1);
    expect(raw.id).toBeUndefined();
    expect(text).not.toContain('PIVOTVALUE');
  });

  it('imports as a template with a new id, through the template migrations', () => {
    const r = readRecipe(writeRecipe(recipeFromTemplate(template)), at);
    if (r.kind !== 'template') throw new Error('expected a template');
    expect(r.template.id).not.toBe(template.id);
    expect(r.template.name).toBe('Tidy names');
    expect(r.template.description).toBe('Trims and title-cases names.');
    expect(r.template.steps.map((s) => s.type)).toEqual(['trimWhitespace', 'pivot']);
    expect(r.template.expectedColumns).toEqual(template.expectedColumns);
    expect(migrateTemplate(JSON.parse(JSON.stringify(r.template)))).toEqual(r.template);
  });

  it('refuses a template recipe with an unknown step', () => {
    const raw = JSON.parse(writeRecipe(recipeFromTemplate(template)));
    raw.nodes[0].steps.push(step('z', 'teleportRows', {}));
    expect(() => parseRecipe(raw, at)).toThrow(/a step \(“teleportRows”\)/);
  });
});

describe('the built-in gallery', () => {
  const dir = join(__dirname, '../../public/recipes');
  const index: string[] = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));

  it('lists every recipe file shipped in public/recipes', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.puddle-recipe.json'));
    expect([...index].sort()).toEqual(files.sort());
    expect(index.length).toBeGreaterThanOrEqual(4);
  });

  it.each(index)('%s opens as a valid pipeline with valid steps and rules, and says what it expects', (file) => {
    const r = pipeline(readRecipe(readFileSync(join(dir, file), 'utf8'), at));
    expect(r.name).not.toBe('Untitled recipe');
    expect(r.description.length).toBeGreaterThan(20);
    const p = projectFromRecipe(r, at);
    expect(p.sources.length).toBeGreaterThan(0);
    for (const s of p.sources) expect(s.expected?.length).toBeGreaterThan(0);
    for (const n of p.nodes) {
      for (const rule of n.rules) expect(() => ruleParams(rule)).not.toThrow();
      if (n.type !== 'transform') continue;
      for (const s of n.steps) {
        const { params } = stepParams(s);
        // Labels read as Puddle would write them.
        expect(s.label).toBe(stepDef(s.type)!.label(params));
      }
    }
    expect(p.nodes.some((n) => n.type === 'output')).toBe(true);
    // Node names are how people (and tests) find nodes on the canvas.
    expect(new Set(p.nodes.map((n) => n.name)).size).toBe(p.nodes.length);
  });
});
