// The schema model written as DBML. parseDbml(writeDbml(schema)) gives the same model (ranges aside), so the writer
// is how a changed model (an import, a diagram edit, sources made into a schema) becomes the project's text.
import { DEFAULT_SCHEMA, type Column, type DbmlSchema, type Default, type Endpoint, type Index, type RecordValue, type Ref, type Table, type TablePartial } from './model';

const KEYWORDS = new Set(['table', 'tablepartial', 'ref', 'enum', 'tablegroup', 'note', 'records', 'project', 'indexes', 'checks', 'as', 'diagramview', 'metadata', 'use', 'true', 'false', 'null']);

/** A name, quoted when it isn't a plain word or could be read as a keyword. */
export function dbmlName(name: string): string {
  if (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) && !KEYWORDS.has(name.toLowerCase())) return name;
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `schema.name`, leaving out the public schema. */
const tableName = (schema: string, name: string) => (schema === DEFAULT_SCHEMA ? dbmlName(name) : `${dbmlName(schema)}.${dbmlName(name)}`);

/** A type bare when DBML reads it bare (`varchar(255)`, `int[]`, `v2.status`), quoted otherwise (`"double precision"`). */
export function dbmlType(type: string): string {
  if (/^[\p{L}_$][\p{L}\p{N}_$]*(\.[\p{L}_$][\p{L}\p{N}_$]*)?(\([^()\n]*\))?(\[\])*$/u.test(type)) return type;
  return `"${type.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A string: single-quoted, or triple-quoted when it spans lines. */
export function dbmlString(text: string, indent = ''): string {
  if (!text.includes('\n')) return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const body = text
    .replace(/\\/g, '\\\\')
    .replace(/'''/g, "\\'''")
    .split('\n')
    .map((l) => (l ? indent + '  ' + l : ''))
    .join('\n');
  return `'''\n${body}\n${indent}'''`;
}

const defaultValue = (d: Default) => (d.kind === 'string' ? dbmlString(d.value) : d.kind === 'expression' ? `\`${d.value}\`` : d.value);

const endpoint = (e: Endpoint) => `${tableName(e.schema, e.table)}.${e.columns.length === 1 ? dbmlName(e.columns[0]!) : `(${e.columns.map(dbmlName).join(', ')})`}`;

const op = (r: Ref) => `${r.fromOptional ? '?' : ''}${r.op}${r.toOptional ? '?' : ''}`;

function settings(items: (string | false | undefined)[]): string {
  const kept = items.filter((x): x is string => !!x);
  return kept.length ? ` [${kept.join(', ')}]` : '';
}

const properties = (props: Record<string, string>) => Object.entries(props).map(([k, v]) => `${k}: ${/^#[0-9a-fA-F]+$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`}`);

function column(c: Column, inlineRefs: Ref[], indent: string): string {
  const s = settings([
    c.pk && 'pk',
    c.increment && 'increment',
    c.notNull === true && 'not null',
    c.notNull === false && 'null',
    c.unique && 'unique',
    c.default && `default: ${defaultValue(c.default)}`,
    ...c.checks.map((x) => `check: \`${x}\``),
    ...inlineRefs.map((r) => `ref: ${op(r)} ${endpoint(r.to)}`),
    c.note !== undefined && `note: ${dbmlString(c.note, indent)}`,
    ...properties(c.properties),
  ]);
  return `${indent}${dbmlName(c.name)} ${dbmlType(c.type)}${s}`;
}

function index(ix: Index): string {
  const parts = ix.parts.map((p) => (p.kind === 'expression' ? `\`${p.value}\`` : dbmlName(p.value)));
  const head = parts.length === 1 && ix.parts[0]!.kind === 'column' ? parts[0]! : `(${parts.join(', ')})`;
  return `    ${head}${settings([ix.pk && 'pk', ix.unique && 'unique', ix.name !== undefined && `name: ${dbmlString(ix.name)}`, ix.type && `type: ${ix.type}`, ix.note !== undefined && `note: ${dbmlString(ix.note)}`])}`;
}

const recordValue = (v: RecordValue) => (v.kind === 'string' ? dbmlString(v.value) : v.kind === 'expression' ? `\`${v.value}\`` : v.kind === 'empty' ? '' : v.value);
const recordRow = (row: RecordValue[]) => row.map(recordValue).join(', ').replace(/ +$/, '');

function body(item: Table | TablePartial, inlineRefs: Map<string, Ref[]>, schema: DbmlSchema | undefined): string[] {
  const lines: string[] = [];
  const own = item.columns.filter((c) => !c.partial);
  const partials = 'partials' in item ? item.partials : [];
  own.forEach((c, i) => {
    for (const p of partials) if (p.at === i) lines.push(`  ~${dbmlName(p.name)}`);
    lines.push(column(c, inlineRefs.get(c.name) ?? [], '  '));
  });
  for (const p of partials) if (p.at >= own.length) lines.push(`  ~${dbmlName(p.name)}`);
  const indexes = item.indexes.filter((ix) => !ix.partial);
  if (indexes.length) lines.push('', '  indexes {', ...indexes.map(index), '  }');
  const checks = item.checks.filter((c) => !c.partial);
  if (checks.length) lines.push('', '  checks {', ...checks.map((c) => `    \`${c.expression}\`${settings([c.name !== undefined && `name: ${dbmlString(c.name)}`])}`), '  }');
  if (schema && 'schema' in item) {
    const recs = schema.records.find((r) => r.inline && r.schema === item.schema && r.table === item.name);
    if (recs) {
      const head = recs.implicit ? 'records' : `records (${recs.columns.map(dbmlName).join(', ')})`;
      lines.push('', `  ${head}${settings([recs.example && 'example'])} {`, ...recs.rows.map((r) => `    ${recordRow(r)}`), '  }');
    }
  }
  if (item.note !== undefined) lines.push('', `  Note: ${dbmlString(item.note, '  ')}`);
  return lines;
}

/** The schema as DBML: project, enums, partials, tables, refs, groups, records, notes and views, in that order. */
export function writeDbml(schema: DbmlSchema): string {
  const out: string[] = [];
  const block = (lines: string[]) => out.push(...lines, '');

  if (schema.project) {
    const p = schema.project;
    const lines = [`Project${p.name !== undefined ? ` ${dbmlName(p.name)}` : ''} {`];
    if (p.databaseType !== undefined) lines.push(`  database_type: ${dbmlString(p.databaseType)}`);
    for (const [k, v] of Object.entries(p.properties)) lines.push(`  ${dbmlName(k)}: ${dbmlString(v)}`);
    if (p.note !== undefined) lines.push(`  Note: ${dbmlString(p.note, '  ')}`);
    block([...lines, '}']);
  }

  for (const e of schema.enums)
    block([`Enum ${tableName(e.schema, e.name)} {`, ...e.values.map((v) => `  ${dbmlName(v.name)}${settings([v.note !== undefined && `note: ${dbmlString(v.note, '  ')}`])}`), '}']);

  for (const p of schema.partials) {
    const s = settings([p.headerColor && `headercolor: ${p.headerColor}`, ...properties(p.properties)]);
    block([`TablePartial ${dbmlName(p.name)}${s} {`, ...body(p, new Map(), undefined), '}']);
  }

  for (const t of schema.tables) {
    const inline = new Map<string, Ref[]>();
    for (const r of schema.refs)
      if (r.inline && r.from.schema === t.schema && r.from.table === t.name) inline.set(r.from.columns[0]!, [...(inline.get(r.from.columns[0]!) ?? []), r]);
    const s = settings([t.headerColor && `headercolor: ${t.headerColor}`, ...properties(t.properties)]);
    block([`Table ${tableName(t.schema, t.name)}${t.alias ? ` as ${dbmlName(t.alias)}` : ''}${s} {`, ...body(t, inline, schema), '}']);
  }

  const refs = schema.refs.filter((r) => !r.inline);
  if (refs.length) {
    for (const r of refs) {
      const s = settings([r.delete && `delete: ${r.delete}`, r.update && `update: ${r.update}`, r.color && `color: ${r.color}`, r.inactive && 'inactive']);
      out.push(`Ref${r.name !== undefined ? ` ${dbmlName(r.name)}` : ''}: ${endpoint(r.from)} ${op(r)} ${endpoint(r.to)}${s}`);
    }
    out.push('');
  }

  for (const g of schema.groups) {
    const s = settings([g.color && `color: ${g.color}`, ...properties(g.properties)]);
    const lines = [`TableGroup ${dbmlName(g.name)}${s} {`, ...g.tables.map((t) => `  ${tableName(t.schema, t.name)}`)];
    if (g.note !== undefined) lines.push(`  Note: ${dbmlString(g.note, '  ')}`);
    block([...lines, '}']);
  }

  for (const r of schema.records.filter((x) => !x.inline))
    block([`records ${tableName(r.schema, r.table)}(${r.columns.map(dbmlName).join(', ')})${settings([r.example && 'example'])} {`, ...r.rows.map((row) => `  ${recordRow(row)}`), '}']);

  for (const n of schema.notes) {
    const s = settings([n.color && `color: ${n.color}`, ...properties(n.properties)]);
    block([`Note ${dbmlName(n.name)}${s} {`, `  ${dbmlString(n.text, '  ')}`, '}']);
  }

  for (const v of schema.views) {
    const lines = [`DiagramView ${dbmlName(v.name)} {`];
    const cats: [string, typeof v.tables][] = [
      ['Tables', v.tables],
      ['Notes', v.notes],
      ['TableGroups', v.groups],
      ['Schemas', v.schemas],
    ];
    for (const [label, list] of cats) {
      if (list === undefined) continue;
      if (list === '*') lines.push(`  ${label} { * }`);
      else lines.push(`  ${label} {`, ...list.map((n) => `    ${n.split('.').map(dbmlName).join('.')}`), '  }');
    }
    block([...lines, '}']);
  }

  return out.join('\n').replace(/\n+$/, '\n');
}
