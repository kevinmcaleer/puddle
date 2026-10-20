// The column catalogue (#186) on real DuckDB-WASM: each detector on a small file of its own, and the fixes it offers
// applied; then the onboarding samples, each listing the issues its note describes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, planFixes, sortIssues, type Issue } from '../../src/analysis';
import { compile, sourceFileName } from '../../src/compiler';
import { detectDateFormats } from '../../src/dates';
import { EngineClient, tableRows } from '../../src/engine/client';
import { placeFixes, setParseOptions, type Project, type Source } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

let engine: EngineClient;
let n = 0;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

/** A CSV written inline, as one source node. */
async function text(csv: string, parseOptions: Source['parseOptions'] = {}): Promise<{ project: Project; sourceId: string }> {
  const source = src({ id: `t${n++}`, format: 'csv', parseOptions });
  await engine.registerText(sourceFileName(source), csv);
  return { project: flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] }), sourceId: source.id };
}

/** A shipped sample, as the app reads it. */
async function sample(name: string, parseOptions: Source['parseOptions'] = {}) {
  const source = src({ id: name.replace(/\W/g, '_'), format: 'csv', parseOptions });
  await engine.registerBuffer(sourceFileName(source), new Uint8Array(readFileSync(join(__dirname, '../../public/samples', name))));
  return { project: flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] }), sourceId: source.id };
}

async function analyse(project: Project, nodeId = 'in') {
  const columns = await engine.describe(`SELECT * FROM (${compile(project, { nodeId }).sql}) LIMIT 0`);
  const analysis = await analyseNode(engine, project, nodeId, columns);
  const issues = sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name));
  return { columns, analysis, issues, by: Object.fromEntries(issues.map((i) => [i.key, i])) };
}

/** Apply the chosen issues' fixes as Fix all does, and read the result. */
async function fix(project: Project, sourceId: string, chosen: (issues: Issue[]) => Issue[]) {
  const before = await analyse(project);
  const { steps, readOptions } = await planFixes(chosen(before.issues), { available: before.columns, locale: project.settings.locale, detectDates: (c) => detectDateFormats(engine, project, { nodeId: 'in' }, c) });
  let fixed = project;
  if (Object.keys(readOptions).length) fixed = setParseOptions(fixed, sourceId, { ...fixed.sources[0]!.parseOptions, ...readOptions });
  const placed = placeFixes(fixed, 'in', steps);
  const target = placed ? { project: placed.project, nodeId: placed.last.nodeId } : { project: fixed, nodeId: 'in' };
  const columns = await engine.describe(`SELECT * FROM (${compile(target.project, { nodeId: target.nodeId }).sql}) LIMIT 0`);
  const rows = tableRows((await engine.query(compile(target.project, { nodeId: target.nodeId }).sql)).table);
  return { before, steps, readOptions, columns, rows, after: await analyse(target.project, target.nodeId) };
}

const fixes = (issues: Issue[]) => issues.filter((i) => i.severity === 'fix');
const withKinds = (...kinds: Issue['kind'][]) => (issues: Issue[]) => issues.filter((i) => i.severity === 'fix' || kinds.includes(i.kind));

describe('each detector on its own file', () => {
  it('placeholders: read as empty on a text source, so the balance becomes a whole column of numbers', async () => {
    const { project, sourceId } = await text('id,status,balance\nA,Active,10.50\nB,n/a,n/a\nC,-,20\nD,NULL,pending\nE,Lapsed,30\nF,?,40\n');
    const { by } = await analyse(project);
    expect(by['placeholders:status']).toMatchObject({ count: 4, examples: ['-', '?', 'NULL'], severity: 'fix', fix: { readOptions: { nullStrings: ['-', '?', 'NULL', 'n/a'] }, label: 'Read "-", "?", "NULL", "n/a" as empty' } });
    // The one word in a column of numbers counts as a placeholder too.
    expect(by['placeholders:balance']).toMatchObject({ count: 2, examples: ['n/a', 'pending'] });
    expect(by['numbersAsText:balance']).toMatchObject({ count: 4, severity: 'fix' });
    const { readOptions, rows, columns } = await fix(project, sourceId, fixes);
    expect(readOptions).toEqual({ nullStrings: ['-', '?', 'NULL', 'n/a', 'pending'] });
    expect(columns.find((c) => c.name === 'balance')?.type).toBe('DOUBLE');
    expect(rows.map((r) => r.status)).toEqual(['Active', null, null, null, 'Lapsed', null]);
    expect(rows.map((r) => r.balance)).toEqual([10.5, null, 20, null, 30, 40]);
  });

  it('placeholders on a node that is not a text source: one Replace values per word', async () => {
    const { project } = await text('id,status\nA,Active\nB,n/a\nC,-\nD,N/A\n');
    const transform: Project = { ...project, nodes: [...project.nodes, { ...project.nodes[0]!, id: 'out', name: 'out', type: 'transform', steps: [] }], edges: [{ id: 'e', from: { nodeId: 'in' }, to: { nodeId: 'out', port: 0 } }] };
    const { by } = await analyse(transform, 'out');
    expect(by['placeholders:status']).toMatchObject({ count: 3, fix: { label: 'Replace values', steps: [{ type: 'replaceValues', params: { find: '-', replaceWithNull: true } }, { type: 'replaceValues', params: { find: 'n/a' } }] } });
  });

  it('booleans as text become BOOLEAN; 1 and 0 are only suggested', async () => {
    const { project, sourceId } = await text('id,active,flag\n1,Y,1\n2,N,0\n3,y,1\n4,n/a,0\n5,N,1\n');
    const { by } = await analyse(project);
    expect(by['booleansAsText:active']).toMatchObject({ count: 4, examples: ['y', 'n'], severity: 'fix', fix: { type: 'changeType', params: { to: 'boolean' } } });
    expect(by['booleansAsText:flag']).toBeUndefined(); // DuckDB read it as BIGINT already
    const { rows, columns } = await fix(project, sourceId, fixes);
    expect(columns.find((c) => c.name === 'active')?.type).toBe('BOOLEAN');
    expect(rows.map((r) => r.active)).toEqual([true, false, true, null, false]);
  });

  it('dates stored as numbers in a date-named column: Excel serials and Unix times, as a suggestion', async () => {
    const { project, sourceId } = await text('id,order_date,created_at,amount\n1,45292,1704067200,45000\n2,45293,1704153600,45001\n3,45294,1704240000,45002\n');
    const { by } = await analyse(project);
    expect(by['serialDates:order_date']).toMatchObject({ severity: 'suggest', examples: ['45292', '45294'], fix: { type: 'parseDates', params: { formats: ['excel serial'] } } });
    expect(by['serialDates:created_at']).toMatchObject({ fix: { type: 'parseDates', params: { formats: ['unix seconds'] } } });
    expect(by['serialDates:amount']).toBeUndefined();
    const { rows, columns } = await fix(project, sourceId, withKinds('serialDates'));
    expect(columns.find((c) => c.name === 'order_date')?.type).toBe('DATE');
    const day = (v: unknown) => new Date(Number(v)).toISOString().slice(0, 10);
    expect(day(rows[0]!.order_date)).toBe('2024-01-01');
    expect(day(rows[0]!.created_at)).toBe('2024-01-01');
  });

  it('mixed types: mostly numbers with some words, offered as a suggestion with the words shown', async () => {
    const { project } = await text('id,total\n1,10\n2,20\n3,free\n4,30\n5,waived\n6,40\n7,50\n8,60\n9,70\n10,tbc?\n');
    const { by } = await analyse(project);
    expect(by['mixedTypes:total']).toMatchObject({ count: 3, examples: ['free', 'tbc?', 'waived'], severity: 'suggest', fix: { type: 'parseNumbers' } });
    expect(by['numbersAsText:total']).toBeUndefined();
  });

  it('a likely misspelling is listed with the common spelling, and Replace values puts it right', async () => {
    const rows = ['London', 'London', 'London', 'Londn', 'Leeds', 'Leeds', 'Leeds', 'leeds', 'Leeds ', 'Paris'];
    const { project, sourceId } = await text(`id,city\n${rows.map((c, i) => `${i},${c}`).join('\n')}\n`);
    const { issues, by } = await analyse(project);
    expect(issues.filter((i) => i.kind === 'nearDuplicate').map((i) => i.key)).toEqual(['nearDuplicate:city:Londn']);
    expect(by['nearDuplicate:city:Londn']).toMatchObject({ value: 'Londn', count: 1, examples: ['Londn', 'London'], severity: 'suggest', fix: { type: 'replaceValues', params: { find: 'Londn', replace: 'London', matchCase: false } } });
    const fixed = await fix(project, sourceId, withKinds('nearDuplicate'));
    expect(fixed.rows.map((r) => r.city)).toEqual(['London', 'London', 'London', 'London', 'Leeds', 'Leeds', 'Leeds', 'Leeds', 'Leeds', 'Paris']);
    expect(fixed.after.issues.filter((i) => i.kind === 'nearDuplicate')).toEqual([]);
  });

  it('values written several ways: a safe fix when only the spaces differ, a note otherwise', async () => {
    const { project, sourceId } = await text('id,postcode,phone\n1,SW1A 1AA,07700 900123\n2,SW1A1AA,+44 7700 900123\n3,EC1A 1BB,07700900123\n4,EC1A1BB,07700 900124\n5,NW1A 0AX,07700 900125\n6,NW1A0AX,07700900126\n');
    const { by } = await analyse(project);
    expect(by['inconsistentShapes:postcode']).toMatchObject({ count: 6, examples: ['AA9A 9AA', 'AA9A9AA'], severity: 'suggest', fix: { type: 'findReplace', params: { find: ' ', replace: '' } } });
    expect(by['inconsistentShapes:phone']).toMatchObject({ severity: 'info', examples: ['+99 9999 999999', '99999 999999', '99999999999'] });
    expect(by['inconsistentShapes:phone']!.fix).toBeUndefined();
    const { rows } = await fix(project, sourceId, withKinds('inconsistentShapes'));
    expect(rows.map((r) => r.postcode)).toEqual(['SW1A1AA', 'SW1A1AA', 'EC1A1BB', 'EC1A1BB', 'NW1A0AX', 'NW1A0AX']);
  });

  it('repeated values in an id column are noted, with the most repeated one', async () => {
    const { project } = await text('order_id,item\n1001,a\n1002,b\n1003,c\n1001,d\n1004,e\n1001,f\n');
    const { by } = await analyse(project);
    expect(by['idDuplicates:order_id']).toMatchObject({ count: 2, examples: ['1001'], severity: 'info' });
    expect(by['idDuplicates:order_id']!.fix).toBeUndefined();
  });

  it('untidy names are renamed in the project’s style; snake_case renames every column that isn’t', async () => {
    const { project, sourceId } = await text('"Customer ID","Full  name",City\n1,Ann,Leeds\n2,Bob,York\n');
    const { by } = await analyse(project);
    expect(by.untidyNames).toMatchObject({ count: 1, examples: ['Full  name'], severity: 'fix', fix: { type: 'renameColumns', params: { renames: [{ from: 'Full  name', to: 'Full name' }] } } });
    const words = await fix(project, sourceId, fixes);
    expect(words.columns.map((c) => c.name)).toEqual(['Customer ID', 'Full name', 'City']);
    const snake = { ...project, settings: { ...project.settings, columnNames: 'snake' as const } };
    const snaked = await fix(snake, sourceId, fixes);
    expect(snaked.columns.map((c) => c.name)).toEqual(['customer_id', 'full_name', 'city']);
    expect(snaked.after.issues.map((i) => i.kind)).not.toContain('untidyNames');
  });

  it('empty, constant and index columns', async () => {
    const { project, sourceId } = await text('Unnamed: 0,id,country,notes\n0,A,UK,\n1,B,UK,\n2,C,UK,\n3,D,UK,\n4,E,UK,\n5,F,UK,\n');
    const { by } = await analyse(project);
    expect(by['indexColumn:Unnamed: 0']).toMatchObject({ severity: 'suggest', fix: { type: 'removeColumns' } });
    expect(by['constantColumn:country']).toMatchObject({ severity: 'info', examples: ['UK'] });
    expect(by['emptyColumn:notes']).toMatchObject({ severity: 'fix', fix: { type: 'removeColumns' } });
    const { columns } = await fix(project, sourceId, withKinds('indexColumn'));
    expect(columns.map((c) => c.name)).toEqual(['id', 'country']);
  });

  it('months as columns: Unpivot is suggested, as text when the columns differ in type', async () => {
    const { project, sourceId } = await text('store,jan_2024,feb_2024,mar_2024\nLeeds,10,"1,200",30\nYork,15,25,n/a\n');
    const { by } = await analyse(project);
    expect(by.wideTable).toMatchObject({ count: 3, examples: ['jan_2024', 'feb_2024', 'mar_2024'], severity: 'suggest', fix: { type: 'unpivot', params: { columns: ['jan_2024', 'feb_2024', 'mar_2024'], attribute: 'month', value: 'value', keepEmpty: true, asText: true } } });
    // On its own (the numbers not parsed first), the values stay as written; gaps are kept as rows.
    const { rows, columns } = await fix(project, sourceId, (issues) => issues.filter((i) => i.kind === 'wideTable'));
    expect(columns.map((c) => c.name)).toEqual(['store', 'month', 'value']);
    expect(rows).toHaveLength(6);
    expect(rows[1]).toMatchObject({ store: 'Leeds', month: 'feb_2024', value: '1,200' });
    expect(rows[5]).toMatchObject({ store: 'York', month: 'mar_2024', value: 'n/a' });
  });

  it('a key and a value in one cell: Split by delimiter is suggested', async () => {
    const { project, sourceId } = await text('id,summary\n1,Total: 1234\n2,Subtotal: 99\n3,Tax: 12.5\n4,Total: 44\n5,Items: 3\n');
    const { by } = await analyse(project);
    expect(by['keyValue:summary']).toMatchObject({ count: 5, examples: ['Items: 3'], severity: 'suggest', fix: { steps: [{ type: 'splitByDelimiter', params: { column: 'summary', delimiterKind: 'colon', at: 'left', into: ['summary key', 'summary value'] } }, { type: 'trimWhitespace' }] } });
    const { rows, columns } = await fix(project, sourceId, withKinds('keyValue'));
    expect(columns.map((c) => c.name)).toEqual(['id', 'summary key', 'summary value']);
    expect(rows[0]).toMatchObject({ 'summary key': 'Total', 'summary value': '1234' });
  });

  it('mangled characters are put back by Fix mangled characters, or by reading the file as UTF-8 when it was read as Latin-1', async () => {
    const { project, sourceId } = await text('id,name\n1,JosÃ© GarcÃ­a\n2,CafÃ© â€œNoirâ€\n3,MÃ¼ller â€“ Â£5\n4,Plain\n');
    const { by } = await analyse(project);
    expect(by['mojibake:name']).toMatchObject({ count: 3, severity: 'fix', fix: { type: 'fixMojibake' } });
    const { rows } = await fix(project, sourceId, fixes);
    expect(rows.map((r) => r.name)).toEqual(['José García', 'Café “Noir”', 'Müller – £5', 'Plain']);

    const latin = await text('id,name\n1,José\n2,Müller\n3,Plain\n', { encoding: 'latin-1' });
    const read = await analyse(latin.project);
    expect(read.by['mojibake:name']).toMatchObject({ count: 2, fix: { readOptions: { encoding: 'utf-8' }, label: 'Read the file as UTF-8' } });
    const reread = await fix(latin.project, latin.sourceId, fixes);
    expect(reread.readOptions).toEqual({ encoding: 'utf-8' });
    expect(reread.rows.map((r) => r.name)).toEqual(['José', 'Müller', 'Plain']);
  });

  it('numbers as text: symbols, thousands, brackets, a trailing minus and codes after the number, with the decimal mark the column uses', async () => {
    const { project, sourceId } = await text('id,gbp,de\n1,"£1,234.50","1.234,50"\n2,(12.00),"891,36 "\n3,496.63 EUR,"7.625,43-"\n4,$99,"20,00"\n');
    const { by } = await analyse(project);
    expect(by['numbersAsText:gbp']).toMatchObject({ severity: 'fix', fix: { type: 'parseNumbers', params: { decimal: '.', locale: '' } } });
    expect(by['numbersAsText:de']).toMatchObject({ severity: 'fix', fix: { type: 'parseNumbers', params: { decimal: ',', locale: '' } } });
    const { rows } = await fix(project, sourceId, fixes);
    expect(rows.map((r) => r.gbp)).toEqual([1234.5, -12, 496.63, 99]);
    expect(rows.map((r) => r.de)).toEqual([1234.5, 891.36, -7625.43, 20]);
  });

  it('dates as text in the ways people write them, day first and with month names', async () => {
    const { project, sourceId } = await text('id,when\n1,31/01/2024\n2,2 Mar 2024\n3,"April 28, 2024"\n4,2024-05-28\n5,12.03.2024\n');
    const { by } = await analyse(project);
    expect(by['datesAsText:when']).toMatchObject({ count: 5, severity: 'fix', fix: { type: 'parseDates' } });
    const { rows, columns } = await fix(project, sourceId, fixes);
    expect(columns.find((c) => c.name === 'when')?.type).toBe('DATE');
    expect(rows.map((r) => new Date(Number(r.when)).toISOString().slice(0, 10))).toEqual(['2024-01-31', '2024-03-02', '2024-04-28', '2024-05-28', '2024-03-12']);
  });
});

describe('the onboarding samples list the issues their notes describe', () => {
  it('contact list: stray and doubled spaces, mixed capitals, blank emails, duplicate rows', async () => {
    const { by, issues } = await analyse((await sample('contacts.csv')).project);
    expect(by.duplicateRows).toMatchObject({ count: 5, severity: 'fix' });
    expect(Object.keys(by)).toEqual(expect.arrayContaining(['edgeSpaces:name', 'edgeSpaces:email', 'edgeSpaces:city', 'doubleSpaces:name', 'mixedCase:city']));
    expect(issues.every((i) => i.kind !== 'untidyNames' && i.kind !== 'indexColumn')).toBe(true);
  });

  it('sales: dates in four formats, amounts as text with symbols, untidy currencies and regions', async () => {
    const { by } = await analyse((await sample('sales.csv')).project);
    expect(by['datesAsText:order_date']).toMatchObject({ severity: 'fix', fix: { type: 'parseDates' } });
    expect(by['numbersAsText:amount']).toMatchObject({ severity: 'fix', fix: { type: 'parseNumbers', params: { decimal: '.' } } });
    expect(by['mixedCase:currency']).toBeDefined();
    expect(by['edgeSpaces:currency']).toBeDefined();
    expect(by['placeholders:region']).toMatchObject({ examples: ['n/a'] });
    expect(by['mixedCase:region'] ?? by['edgeSpaces:region']).toBeDefined();
  });

  it('orders and customers: ids with stray spaces and lower case', async () => {
    const { by } = await analyse((await sample('orders.csv')).project);
    expect(by['edgeSpaces:customer_id']).toBeDefined();
    expect(by['mixedCase:customer_id']).toBeDefined();
    expect(by['idDuplicates:order_id']).toBeUndefined();
  });

  it('monthly sales: a wide table to unpivot, gaps written three ways, numbers as text', async () => {
    const { project, sourceId } = await sample('monthly-sales.csv');
    const { by } = await analyse(project);
    expect(by.wideTable).toMatchObject({ count: 12, severity: 'suggest', fix: { type: 'unpivot', params: { attribute: 'month', keepEmpty: true, asText: false } } });
    expect(Object.keys(by).filter((k) => k.startsWith('placeholders:')).length).toBeGreaterThan(0);
    expect(Object.keys(by).filter((k) => k.startsWith('numbersAsText:')).length).toBeGreaterThan(0);
    // Fix all with the unpivot: one row per store and month, the sales as numbers once parsed again.
    const { rows, columns } = await fix(project, sourceId, withKinds('wideTable'));
    expect(columns.map((c) => c.name)).toEqual(['store', 'region', 'month', 'value']);
    expect(columns.find((c) => c.name === 'value')?.type).toBe('DOUBLE');
    expect(rows.length).toBe(8 * 12);
    expect(rows.some((r) => r.value == null)).toBe(true);
  });
});
