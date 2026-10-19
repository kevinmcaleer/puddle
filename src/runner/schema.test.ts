import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportSql } from '../compiler/ddl/export';
import { migrationSql } from '../compiler/ddl/migration';
import { createProject, setSchemaDbml } from '../model';
import { defaultDocsTokens, writeDocsHtml, writeDocsMarkdown } from '../schema/docs';
import { writeMermaid } from '../schema/mermaid';
import { parseDbml } from '../schema/parse';
import { writeDbml } from '../schema/write';
import { parseSchemaArgs, schemaCommand } from './schema';

const fixture = (name: string) => readFileSync(join(__dirname, '../../tests/fixtures/dbml', name), 'utf8');
const SHOP = fixture('shop.dbml');
const shop = parseDbml(SHOP).schema;

/** The command over files held in memory. */
function run(argv: string[], files: Record<string, string>) {
  const written: Record<string, string> = {};
  const out: string[] = [];
  const err: string[] = [];
  const code = schemaCommand(argv, {
    readFile: (f) => {
      if (!(f in files)) throw new Error('no such file');
      return files[f]!;
    },
    writeFile: (f, t) => void (written[f] = t),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, written, out, err };
}

const projectFile = (name: string, dbml: string) => JSON.stringify(setSchemaDbml(createProject(name), dbml));

describe('puddle-run schema arguments', () => {
  it('reads every option', () => {
    expect(parseSchemaArgs(['p.puddle.json', '--check', '--dbml', 'a.dbml', '--ddl', 'mysql', 'a.sql', '--records', '--docs', 'a.html', '--docs-md', 'a.md', '--mermaid', 'a.mmd', '--diff', 'old.dbml', '--migration', 'postgres', 'm.sql'])).toEqual({
      file: 'p.puddle.json',
      check: true,
      dbml: 'a.dbml',
      ddl: { dialect: 'mysql', path: 'a.sql' },
      records: true,
      docs: 'a.html',
      docsMd: 'a.md',
      mermaid: 'a.mmd',
      diff: 'old.dbml',
      migration: { dialect: 'postgres', path: 'm.sql' },
    });
  });

  it.each([
    [[], 'Name a project file or a .dbml file.'],
    [['a.dbml', '--ddl', 'oracle', 'a.sql'], '--ddl needs a dialect first: postgres, mysql, sqlserver, sqlite, duckdb, not “oracle”.'],
    [['a.dbml', '--docs'], '--docs needs a file name.'],
    [['a.dbml', '--migration', 'postgres', 'm.sql'], '--migration needs --diff <older file> to say what it migrates from.'],
    [['a.dbml', '--nope'], 'Unknown option --nope.'],
    [['a.dbml', 'b.dbml'], 'One file at a time: a.dbml or b.dbml?'],
  ])('%j says %s', (argv, message) => {
    expect(parseSchemaArgs(argv)).toBe(message);
  });

  it('exits 2 with the usage when the arguments are wrong', () => {
    const r = run(['--nope'], {});
    expect(r.code).toBe(2);
    expect(r.err[0]).toBe('Unknown option --nope.');
  });
});

describe('puddle-run schema', () => {
  it('--check exits 0 on a good schema and 1 with each error’s line and column on a broken one', () => {
    expect(run(['shop.dbml', '--check'], { 'shop.dbml': SHOP })).toMatchObject({ code: 0, out: ['shop.dbml: the DBML is fine (4 tables).'] });
    const broken = run(['broken.dbml', '--check', '--dbml', 'x.dbml'], { 'broken.dbml': 'Table a {\n  id int [pk\n}\n' });
    expect(broken.code).toBe(1);
    expect(broken.err[0]).toMatch(/^broken\.dbml:\d+:\d+: /);
    expect(broken.written).toEqual({});
  });

  it('reads a project file’s schema the same as a .dbml file', () => {
    const r = run(['shop.puddle.json', '--dbml', 'out.dbml'], { 'shop.puddle.json': projectFile('Shop', SHOP) });
    expect(r.code).toBe(0);
    expect(r.written['out.dbml']).toBe(writeDbml(shop));
  });

  it('writes what the app writes: SQL, docs, Markdown and Mermaid', () => {
    const r = run(['Shop.dbml', '--ddl', 'postgres', 'shop.sql', '--records', '--docs', 'shop.html', '--docs-md', 'shop.md', '--mermaid', 'shop.mmd'], { 'Shop.dbml': SHOP });
    expect(r.code).toBe(0);
    expect(r.written['shop.sql']).toBe(exportSql(shop, 'postgres', { records: true }).sql);
    expect(r.written['shop.html']).toBe(writeDocsHtml(shop, { title: 'Shop', views: [], tokens: defaultDocsTokens() }));
    expect(r.written['shop.md']).toBe(writeDocsMarkdown(shop, { title: 'Shop' }));
    expect(r.written['shop.mmd']).toBe(writeMermaid(shop));
  });

  it('--diff prints the changes by table, and --migration writes the script', () => {
    const older = 'Table customers {\n  id int [pk]\n}\nTable orders {\n  id int [pk]\n}\n';
    const newer = 'Table customers {\n  id int [pk]\n}\nTable orders {\n  id int [pk]\n  customer_id int [ref: > customers.id]\n}\n';
    const r = run(['new.dbml', '--diff', 'old.puddle.json', '--migration', 'postgres', 'm.sql'], { 'new.dbml': newer, 'old.puddle.json': projectFile('Old', older) });
    expect(r.code).toBe(0);
    expect(r.out.slice(0, 4)).toEqual(['Changes since old.puddle.json:', '  orders', '    Added column customer_id (int)', '    Added ref customer_id > customers.id']);
    expect(r.written['m.sql']).toBe(migrationSql(parseDbml(older).schema, parseDbml(newer).schema, 'postgres').sql);
  });

  it('says when a file can’t be read', () => {
    expect(run(['gone.dbml', '--check'], {})).toMatchObject({ code: 1, err: ['gone.dbml can’t be read: no such file'] });
  });
});
