// A database's catalogue, as a driver describes it (src/connect/types.ts CatalogDetail), as the Phase 4 schema
// model: a Table per table or view, its keys, indexes and defaults, a Ref per foreign key, an Enum per enum, and a
// TableGroup named after the connection holding them all, so the project's DBML says which tables came from where.
// Documenting again replaces what the group holds, by the offsets the parser keeps, and leaves the user's own text as
// it is. Pure; the action that reads a connection and writes the project is src/connections/document.ts.
import type { CatalogDetail, DocColumn, DocTable } from '../connect/types';
import { intoSchema } from '../relationships/dbml';
import { diffSchemas, type SchemaDiff } from './diff';
import { DEFAULT_SCHEMA, emptySchema, tableKey, type Column, type DbmlSchema, type Ref, type Table, type TableGroup } from './model';
import { parseDbml } from './parse';
import { writeDbml } from './write';

export interface DocumentOptions {
  /** The group's name: the connection's. */
  group: string;
  /** The DBML schema tables with no schema of their own go in; the default (public) unless it would clash. */
  schema?: string;
  /** The group's note: where and when the schema was read. */
  note?: string;
}

/** A default as the database wrote it: a number, a quoted string, true or false, NULL, or an expression. */
export function defaultFrom(text: string): Column['default'] {
  const t = text.trim();
  if (!t) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'number', value: t };
  if (/^(true|false)$/i.test(t)) return { kind: 'boolean', value: t.toLowerCase() };
  if (/^null$/i.test(t)) return { kind: 'null', value: 'null' };
  const quoted = /^'((?:[^']|'')*)'$/.exec(t);
  if (quoted) return { kind: 'string', value: quoted[1]!.replaceAll("''", "'") };
  return { kind: 'expression', value: t };
}

const column = (c: DocColumn): Column => ({
  name: c.name,
  type: c.type || 'unknown',
  pk: c.pk,
  unique: c.unique,
  ...(c.notNull && !c.pk ? { notNull: true } : {}),
  increment: c.increment,
  ...(c.default !== undefined ? { default: defaultFrom(c.default) } : {}),
  checks: [],
  ...(c.note !== undefined ? { note: c.note } : {}),
  properties: {},
});

/** A view's note: what it is, and the SQL that defines it. */
const viewNote = (t: DocTable) => (t.sql ? `View, defined as:\n${t.sql.trim()}` : 'View');

function table(t: DocTable, schema: string): Table {
  const note = t.kind === 'view' ? [viewNote(t), t.note].filter(Boolean).join('\n\n') : t.note;
  return {
    schema: t.schema ?? schema,
    name: t.name,
    properties: {},
    columns: t.columns.map(column),
    indexes: t.indexes.map((ix) => ({ parts: ix.columns.map((value) => ({ kind: 'column' as const, value })), unique: ix.unique, pk: false, ...(ix.name ? { name: ix.name } : {}) })),
    checks: [],
    partials: [],
    ...(note !== undefined ? { note } : {}),
  };
}

/** The catalogue as a schema: tables, refs (many-to-one, child to parent), enums and the group holding the tables. */
export function schemaFromCatalog(detail: CatalogDetail, options: DocumentOptions): DbmlSchema {
  const schema = options.schema ?? DEFAULT_SCHEMA;
  const tables = detail.tables.map((t) => table(t, schema));
  const known = new Set(tables.map((t) => tableKey(t.schema, t.name)));
  const refs: Ref[] = [];
  for (const t of detail.tables) {
    for (const fk of t.foreignKeys) {
      const parentSchema = fk.refSchema ?? t.schema ?? schema;
      const parent = tables.find((x) => x.schema === parentSchema && x.name === fk.refTable);
      // A reference with no columns named points at the parent's primary key.
      const refColumns = fk.refColumns.every((c) => c) ? fk.refColumns : (parent?.columns.filter((c) => c.pk).map((c) => c.name) ?? []);
      if (!fk.columns.length || refColumns.length !== fk.columns.length || !known.has(tableKey(parentSchema, fk.refTable))) continue;
      refs.push({ ...(fk.name ? { name: fk.name } : {}), from: { schema: t.schema ?? schema, table: t.name, columns: fk.columns }, to: { schema: parentSchema, table: fk.refTable, columns: refColumns }, op: '>', fromOptional: false, toOptional: false, inactive: false, inline: false });
    }
  }
  const group: TableGroup = { name: options.group, tables: tables.map((t) => ({ schema: t.schema, name: t.name })), properties: {}, ...(options.note ? { note: options.note } : {}) };
  return { ...emptySchema(), tables, refs, enums: detail.enums.map((e) => ({ schema: e.schema ?? schema, name: e.name, values: e.values.map((name) => ({ name })) })), groups: tables.length ? [group] : [] };
}

const inGroup = (group: TableGroup | undefined) => new Set(group?.tables.map((t) => tableKey(t.schema, t.name)) ?? []);

/** The enums only the group's tables use (by bare or qualified name), so documenting again can replace them. */
function groupEnums(schema: DbmlSchema, keys: Set<string>): DbmlSchema['enums'] {
  const uses = (t: Table, e: DbmlSchema['enums'][number]) => t.columns.some((c) => c.type === e.name || c.type === `${e.schema}.${e.name}`);
  return schema.enums.filter((e) => schema.tables.some((t) => keys.has(tableKey(t.schema, t.name)) && uses(t, e)) && !schema.tables.some((t) => !keys.has(tableKey(t.schema, t.name)) && uses(t, e)));
}

/** What a group holds in a schema: its tables, the refs between them, and the enums only they use; nothing when there is no such group. */
export function documentedPart(schema: DbmlSchema, group: string): DbmlSchema | null {
  const g = schema.groups.find((x) => x.name === group);
  if (!g) return null;
  const keys = inGroup(g);
  const has = (e: Ref['from']) => keys.has(tableKey(e.schema, e.table));
  return { ...emptySchema(), tables: schema.tables.filter((t) => keys.has(tableKey(t.schema, t.name))), refs: schema.refs.filter((r) => has(r.from) && has(r.to)), enums: groupEnums(schema, keys), groups: [g] };
}

/** What documenting again changes: the group's note says only when it was read, so it is left out. */
export function documentDiff(before: DbmlSchema, generated: DbmlSchema): SchemaDiff {
  const quiet = (s: DbmlSchema): DbmlSchema => ({ ...s, groups: s.groups.map(({ note: _n, ...g }) => g) });
  return diffSchemas(quiet(before), quiet(generated));
}

/** The DBML with everything a group holds cut out, by the offsets the parser keeps, so the rest stays as written. */
export function removeDocumented(dbml: string, group: string): string {
  const schema = parseDbml(dbml).schema;
  const g = schema.groups.find((x) => x.name === group);
  if (!g) return dbml;
  const keys = inGroup(g);
  const has = (e: Ref['from']) => keys.has(tableKey(e.schema, e.table));
  const ranges = [
    g.range,
    ...schema.tables.filter((t) => keys.has(tableKey(t.schema, t.name))).map((t) => t.range),
    // A ref written on a column line goes with its table; one written on its own is cut when it touches the group.
    ...schema.refs.filter((r) => !r.inline && (has(r.from) || has(r.to))).map((r) => r.range),
    ...groupEnums(schema, keys).map((e) => e.range),
  ].filter((r): r is NonNullable<typeof r> => !!r);
  let out = dbml;
  for (const r of ranges.sort((a, b) => b.start - a.start)) {
    // Take the line the element ends on with it.
    let end = r.end;
    while (end < out.length && out[end] !== '\n' && /\s/.test(out[end]!)) end++;
    if (out[end] === '\n') end++;
    let start = r.start;
    while (start > 0 && out[start - 1] !== '\n' && /\s/.test(out[start - 1]!)) start--;
    out = out.slice(0, start) + out.slice(end);
  }
  return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

/**
 * The DBML schema name the documented tables go in: the default unless one of them would clash with a table of the
 * user's own (or another connection's) there, then one made from the group's name.
 */
export function documentSchemaName(dbml: string, group: string, detail: CatalogDetail): string {
  const schema = parseDbml(dbml).schema;
  const keys = inGroup(schema.groups.find((x) => x.name === group));
  const clash = detail.tables.some((t) => !t.schema && schema.tables.some((x) => x.schema === DEFAULT_SCHEMA && x.name === t.name && !keys.has(tableKey(x.schema, x.name))));
  if (!clash) return DEFAULT_SCHEMA;
  const slug = group
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'database';
}

/** The project's DBML with the catalogue documented into it: what the group held before is replaced, the rest kept. */
export function documentInto(dbml: string, generated: DbmlSchema, group: string): string {
  return intoSchema(removeDocumented(dbml, group), writeDbml(generated).trimEnd() + '\n', 'append');
}

/** The table a connection source would be checked against, when its connection's group documents it. */
export function documentedTable(dbml: string, group: string, table: { schema?: string; name: string }): { schema: string; table: string } | undefined {
  const part = documentedPart(parseDbml(dbml).schema, group);
  const t = part?.tables.find((x) => x.name === table.name && (table.schema ? x.schema === table.schema : true));
  return t ? { schema: t.schema, table: t.name } : undefined;
}
