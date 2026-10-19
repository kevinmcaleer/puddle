// puddle-run schema: the jobs the Schema view does, from a project file or a plain .dbml file, for CI pipelines.
// Check the DBML, and write it normalised, as SQL for a database, as docs or as Mermaid; compare it with an older
// file and write the migration. Pure apart from the files it is handed, so it is tested without a shell.
import { basename } from 'node:path';
import { exportSql } from '../compiler/ddl/export';
import { migrationSql } from '../compiler/ddl/migration';
import { DDL_DIALECTS, type DdlDialect } from '../compiler/sql';
import { readProjectFile } from '../persistence/migrate';
import { defaultDocsTokens, writeDocsHtml, writeDocsMarkdown } from '../schema/docs';
import { diffSchemas } from '../schema/diff';
import { writeMermaid } from '../schema/mermaid';
import type { DbmlSchema } from '../schema/model';
import { parseDbml, type SchemaError } from '../schema/parse';
import { writeDbml } from '../schema/write';

/** What the command reads, writes and says: the real file system and console, or stand-ins in tests. */
export interface SchemaIo {
  readFile: (path: string) => string;
  writeFile: (path: string, text: string) => void;
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface SchemaArgs {
  file?: string;
  check: boolean;
  dbml?: string;
  ddl?: { dialect: DdlDialect; path: string };
  records: boolean;
  docs?: string;
  docsMd?: string;
  mermaid?: string;
  diff?: string;
  migration?: { dialect: DdlDialect; path: string };
}

export const SCHEMA_USAGE = `puddle-run schema <project.puddle.json | schema.dbml> [options]

  --check                         exit 1 with each DBML error (line and column) if there are any
  --dbml <out.dbml>               the DBML, as Puddle writes it
  --ddl <dialect> <out.sql>       the CREATE script for ${DDL_DIALECTS.join(', ')}
  --records                       with --ddl: INSERT the DBML's records too
  --docs <out.html>               the docs page, as Export › Docs writes it (without the diagrams, which need a browser)
  --docs-md <out.md>              the docs as Markdown
  --mermaid <out.mmd>             the diagram as a Mermaid erDiagram
  --diff <older file>             print what changed since the older project or .dbml file
  --migration <dialect> <out.sql> with --diff: the script that takes the older schema to this one`;

/** The arguments after `schema`, or a sentence saying what is wrong with them. */
export function parseSchemaArgs(argv: string[]): SchemaArgs | string {
  const args: SchemaArgs = { check: false, records: false };
  const dialect = (d: string | undefined) => (DDL_DIALECTS.includes(d as DdlDialect) ? (d as DdlDialect) : undefined);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a file name.`);
      return v;
    };
    const withDialect = () => {
      const d = argv[++i];
      const known = dialect(d);
      if (!known) throw new Error(`${a} needs a dialect first: ${DDL_DIALECTS.join(', ')}${d ? `, not “${d}”` : ''}.`);
      return { dialect: known, path: value() };
    };
    try {
      if (a === '--check') args.check = true;
      else if (a === '--records') args.records = true;
      else if (a === '--dbml') args.dbml = value();
      else if (a === '--ddl') args.ddl = withDialect();
      else if (a === '--docs') args.docs = value();
      else if (a === '--docs-md') args.docsMd = value();
      else if (a === '--mermaid') args.mermaid = value();
      else if (a === '--diff') args.diff = value();
      else if (a === '--migration') args.migration = withDialect();
      else if (a.startsWith('--')) return `Unknown option ${a}.`;
      else if (args.file) return `One file at a time: ${args.file} or ${a}?`;
      else args.file = a;
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (!args.file) return 'Name a project file or a .dbml file.';
  if (args.migration && !args.diff) return '--migration needs --diff <older file> to say what it migrates from.';
  return args;
}

/** A file's DBML and a title for its docs: a project's schema and name, or a .dbml file's text and name. */
export function readSchemaFile(path: string, text: string): { dbml: string; title: string } {
  if (/\.dbml$/i.test(path)) return { dbml: text, title: basename(path).replace(/\.dbml$/i, '') };
  const project = readProjectFile(text);
  return { dbml: project.schema.dbml, title: project.name };
}

const where = (file: string, e: SchemaError) => `${file}:${e.line}:${e.column}: ${e.message}`;

/** Run `puddle-run schema`; the exit code comes back: 0 done, 1 the DBML has errors, 2 the arguments are wrong. */
export function schemaCommand(argv: string[], io: SchemaIo): number {
  const args = parseSchemaArgs(argv);
  if (typeof args === 'string') {
    io.err(args);
    io.err(SCHEMA_USAGE);
    return 2;
  }
  const load = (path: string): { schema: DbmlSchema; title: string; errors: SchemaError[] } => {
    const { dbml, title } = readSchemaFile(path, io.readFile(path));
    const parsed = parseDbml(dbml);
    return { schema: parsed.schema, title, errors: parsed.errors };
  };
  let current: ReturnType<typeof load>;
  try {
    current = load(args.file!);
  } catch (e) {
    io.err(`${args.file} can’t be read: ${(e as Error).message}`);
    return 1;
  }
  for (const e of current.errors) io.err(where(args.file!, e));
  if (current.errors.length) {
    io.err(`${current.errors.length} ${current.errors.length === 1 ? 'error' : 'errors'} in the DBML; nothing written.`);
    return 1;
  }
  const { schema, title } = current;
  if (args.check) io.out(`${args.file}: the DBML is fine (${schema.tables.length} ${schema.tables.length === 1 ? 'table' : 'tables'}).`);
  const write = (path: string, text: string, what: string) => {
    io.writeFile(path, text);
    io.out(`Wrote ${what} to ${path}`);
  };
  if (args.dbml) write(args.dbml, writeDbml(schema), 'the DBML');
  if (args.ddl) {
    const script = exportSql(schema, args.ddl.dialect, { records: args.records });
    write(args.ddl.path, script.sql, `the ${args.ddl.dialect} script`);
    for (const w of script.warnings) io.err(`Note: ${w}`);
  }
  if (args.docs) write(args.docs, writeDocsHtml(schema, { title, views: [], tokens: defaultDocsTokens() }), 'the docs');
  if (args.docsMd) write(args.docsMd, writeDocsMarkdown(schema, { title }), 'the docs as Markdown');
  if (args.mermaid) write(args.mermaid, writeMermaid(schema), 'the Mermaid diagram');
  if (args.diff) {
    let older: ReturnType<typeof load>;
    try {
      older = load(args.diff);
    } catch (e) {
      io.err(`${args.diff} can’t be read: ${(e as Error).message}`);
      return 1;
    }
    if (older.errors.length) {
      for (const e of older.errors) io.err(where(args.diff, e));
      return 1;
    }
    const diff = diffSchemas(older.schema, schema);
    if (!diff.changes.length) io.out(`No changes since ${args.diff}.`);
    else {
      io.out(`Changes since ${args.diff}:`);
      for (const t of diff.tables.filter((x) => x.changes.length)) {
        io.out(`  ${t.schema === 'public' ? t.name : `${t.schema}.${t.name}`}`);
        for (const c of t.changes) io.out(`    ${c.text}`);
      }
      for (const c of [...diff.enums, ...diff.other]) io.out(`  ${c.text}`);
    }
    if (args.migration) {
      const m = migrationSql(older.schema, schema, args.migration.dialect);
      write(args.migration.path, m.sql, `the ${args.migration.dialect} migration`);
      for (const l of m.lossy) io.err(`Loses data: ${l}`);
      for (const w of m.warnings) io.err(`By hand: ${w}`);
    }
  }
  return 0;
}
