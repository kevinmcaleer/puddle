// What changed between two versions of a schema, in words: tables, columns, keys, indexes, checks, refs, enums,
// groups and notes, grouped by the table each change belongs to. A rename is told from a drop and an add only when
// nothing else explains it. Also a line diff of two DBML texts for showing them side by side. Pure; the migration
// script in src/compiler/ddl/migration.ts is built from this.
import { DEFAULT_SCHEMA, tableKey, type Check, type Column, type DbmlEnum, type DbmlSchema, type Index, type Ref, type Table } from './model';
import { dbmlName, defaultValue, writeEndpoint, writeRefOp } from './write';

export type ChangeAction = 'add' | 'remove' | 'change';

interface Base {
  action: ChangeAction;
  /** The change in a sentence-case phrase: `Added column email (varchar)`. */
  text: string;
}

/** A change to a column that is in both versions: `column` as it is now, `was` as it was. */
export type ColumnChangeKind = 'column-renamed' | 'column-type' | 'column-null' | 'column-default' | 'column-increment' | 'column-unique' | 'column-check' | 'column-note';

export type SchemaChange =
  | (Base & { kind: 'table-added' | 'table-removed' | 'table-renamed' | 'table-note' | 'records' })
  | (Base & { kind: 'column-added'; column: Column })
  | (Base & { kind: 'column-removed'; was: Column })
  | (Base & { kind: ColumnChangeKind; column: Column; was: Column; check?: string })
  | (Base & { kind: 'primary-key'; columns: string[]; was: string[] })
  /** `position` is the index's place among its table's indexes, which names it when it has no name of its own. */
  | (Base & { kind: 'index-added' | 'index-removed'; index: Index; position: number })
  | (Base & { kind: 'check-added' | 'check-removed'; check: Check })
  | (Base & { kind: 'ref-added' | 'ref-removed'; ref: Ref })
  | (Base & { kind: 'ref-changed'; ref: Ref; was: Ref })
  | (Base & { kind: 'enum-added' | 'enum-removed'; enum: DbmlEnum })
  | (Base & { kind: 'enum-value-added' | 'enum-value-removed'; enum: DbmlEnum; value: string })
  | (Base & { kind: 'group-added' | 'group-removed' | 'group-changed' | 'sticky-note-added' | 'sticky-note-removed' | 'sticky-note-changed'; name: string })
  | (Base & { kind: 'project-note' });

export type ChangeKind = SchemaChange['kind'];

/** The change of one kind, with the fields that kind has. */
export type ChangeOf<K extends ChangeKind> = SchemaChange extends infer C ? (C extends { kind: infer CK } ? (K extends CK ? C & { kind: K } : never) : never) : never;

/** The changes to one table. `older` and `newer` are the table in each version (one is missing when it was added or removed). */
export interface TableDiff {
  schema: string;
  /** Its name now, or its last name when it was removed. */
  name: string;
  status: 'added' | 'removed' | 'renamed' | 'changed';
  older?: Table;
  newer?: Table;
  changes: SchemaChange[];
}

export interface SchemaDiff {
  /** Tables with changes: those in the newer version in its order, then the removed ones. Refs are listed under the table they start from. */
  tables: TableDiff[];
  enums: SchemaChange[];
  /** Groups, sticky notes and the project note. */
  other: SchemaChange[];
  /** Every change, in the order above. */
  changes: SchemaChange[];
}

/** The primary key's columns: those marked pk, or a pk index of columns. */
function keyOf(t: Table): string[] {
  const own = t.columns.filter((c) => c.pk).map((c) => c.name);
  if (own.length) return own;
  const ix = t.indexes.find((i) => i.pk && i.parts.every((p) => p.kind === 'column'));
  return ix ? ix.parts.map((p) => p.value) : [];
}

/** `schema.name` in DBML, leaving out the public schema. */
const nameOf = (schema: string, name: string) => (schema === DEFAULT_SCHEMA ? dbmlName(name) : `${dbmlName(schema)}.${dbmlName(name)}`);
const list = (names: string[]) => (names.length === 1 ? dbmlName(names[0]!) : `(${names.map(dbmlName).join(', ')})`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nullable = (c: Column) => c.notNull !== true;
const indexParts = (ix: Index) => ix.parts.map((p) => (p.kind === 'expression' ? `\`${p.value}\`` : dbmlName(p.value)));
const indexKey = (ix: Index) => `${ix.unique}|${ix.type ?? ''}|${ix.parts.map((p) => `${p.kind}:${p.value}`).join(',')}`;
const signature = (t: Table) => t.columns.map((c) => `${c.name}:${c.type}`).sort().join('\n');
const settingsOf = (c: Column) => JSON.stringify([c.type, c.pk, c.unique, c.notNull === true, c.increment, c.default ?? null, c.checks]);

/** One endpoint pair of a ref, the same whichever way round it is written. */
function refKey(r: Ref): string {
  const ends = [r.from, r.to].map((e) => `${e.schema}.${e.table}.${e.columns.join(',')}`);
  return ends.sort().join(' ');
}

/** A ref in words from its own table: `customer_id > customers.id`. */
const refText = (r: Ref) => `${list(r.from.columns)} ${writeRefOp(r)} ${writeEndpoint(r.to)}`;

/** The ref written from the same end as `like`: `a.id < b.a_id` is `b.a_id > a.id`. */
function oriented(r: Ref, like: Ref): Ref {
  const end = (e: Ref['from']) => `${e.schema}.${e.table}.${e.columns.join(',')}`;
  if (end(r.from) === end(like.from)) return r;
  const op = r.op === '<' ? '>' : r.op === '>' ? '<' : r.op;
  return { ...r, from: r.to, to: r.from, op, fromOptional: r.toOptional, toOptional: r.fromOptional };
}

function refDetails(older: Ref, now: Ref): string[] {
  const was = oriented(older, now);
  const out: string[] = [];
  if (writeRefOp(was) !== writeRefOp(now)) out.push(`was ${writeRefOp(was)}`);
  for (const k of ['delete', 'update'] as const) if (was[k] !== now[k]) out.push(`on ${k} ${now[k] ?? 'not set'}${was[k] ? ` instead of ${was[k]}` : ''}`);
  if (was.inactive !== now.inactive) out.push(now.inactive ? 'made inactive' : 'made active');
  if (was.name !== now.name) out.push(now.name ? `named ${now.name}` : 'name removed');
  if (was.color !== now.color) out.push('colour changed');
  return out;
}

/** Pairs a removed and an added item that only one of each matches; the rest stay unpaired. */
function pairUnique<T>(removed: T[], added: T[], match: (a: T, b: T) => boolean): [T, T][] {
  const pairs: [T, T][] = [];
  for (const r of removed) {
    const hits = added.filter((a) => match(r, a));
    if (hits.length !== 1) continue;
    const back = removed.filter((x) => match(x, hits[0]!));
    if (back.length === 1) pairs.push([r, hits[0]!]);
  }
  return pairs;
}

function columnChanges(was: Column, now: Column): SchemaChange[] {
  const out: SchemaChange[] = [];
  const name = dbmlName(now.name);
  const at = { column: now, was };
  if (was.type !== now.type) out.push({ kind: 'column-type', action: 'change', text: `Changed the type of ${name} from ${was.type} to ${now.type}`, ...at });
  if (nullable(was) !== nullable(now)) out.push({ kind: 'column-null', action: 'change', text: nullable(now) ? `Made ${name} nullable` : `Made ${name} not null`, ...at });
  if (!same(was.default, now.default)) {
    const text = !now.default ? `Removed the default of ${name}` : !was.default ? `Set the default of ${name} to ${defaultValue(now.default)}` : `Changed the default of ${name} from ${defaultValue(was.default)} to ${defaultValue(now.default)}`;
    out.push({ kind: 'column-default', action: !now.default ? 'remove' : !was.default ? 'add' : 'change', text, ...at });
  }
  if (was.increment !== now.increment) out.push({ kind: 'column-increment', action: now.increment ? 'add' : 'remove', text: now.increment ? `Made ${name} increment` : `Stopped ${name} incrementing`, ...at });
  if (was.unique !== now.unique) out.push({ kind: 'column-unique', action: now.unique ? 'add' : 'remove', text: now.unique ? `Added unique on ${name}` : `Removed unique on ${name}`, ...at });
  for (const x of was.checks.filter((x) => !now.checks.includes(x))) out.push({ kind: 'column-check', action: 'remove', text: `Removed check \`${x}\` on ${name}`, check: x, ...at });
  for (const x of now.checks.filter((x) => !was.checks.includes(x))) out.push({ kind: 'column-check', action: 'add', text: `Added check \`${x}\` on ${name}`, check: x, ...at });
  if (was.note !== now.note) out.push({ kind: 'column-note', action: now.note == null ? 'remove' : was.note == null ? 'add' : 'change', text: `${now.note == null ? 'Removed' : was.note == null ? 'Added' : 'Changed'} the note on ${name}`, ...at });
  return out;
}

/** What changed within a table that is in both versions (perhaps renamed). */
function tableChanges(was: Table, now: Table, older: DbmlSchema, newer: DbmlSchema): SchemaChange[] {
  const out: SchemaChange[] = [];
  if (was.note !== now.note) out.push({ kind: 'table-note', action: now.note == null ? 'remove' : was.note == null ? 'add' : 'change', text: `${now.note == null ? 'Removed' : was.note == null ? 'Added' : 'Changed'} the note on ${dbmlName(now.name)}` });

  const removed = was.columns.filter((c) => !now.columns.some((x) => x.name === c.name));
  const added = now.columns.filter((c) => !was.columns.some((x) => x.name === c.name));
  const renamed: [Column, Column] | undefined = removed.length === 1 && added.length === 1 && settingsOf(removed[0]!) === settingsOf(added[0]!) ? [removed[0]!, added[0]!] : undefined;
  for (const c of removed) if (c !== renamed?.[0]) out.push({ kind: 'column-removed', action: 'remove', text: `Removed column ${dbmlName(c.name)}`, was: c });
  for (const c of now.columns) {
    if (c === renamed?.[1]) {
      out.push({ kind: 'column-renamed', action: 'change', text: `Renamed column ${dbmlName(renamed[0].name)} to ${dbmlName(c.name)}`, column: c, was: renamed[0] });
      out.push(...columnChanges(renamed[0], c).filter((x) => x.kind === 'column-note'));
    } else if (added.includes(c)) out.push({ kind: 'column-added', action: 'add', text: `Added column ${dbmlName(c.name)} (${c.type})`, column: c });
    else out.push(...columnChanges(was.columns.find((x) => x.name === c.name)!, c));
  }

  const rename = (n: string) => (renamed && n === renamed[0].name ? renamed[1].name : n);
  const [keyWas, keyNow] = [keyOf(was).map(rename), keyOf(now)];
  if (!same(keyWas, keyNow)) {
    const text = !keyNow.length ? `Removed primary key on ${list(keyWas)}` : !keyWas.length ? `Added primary key on ${list(keyNow)}` : `Changed the primary key from ${list(keyWas)} to ${list(keyNow)}`;
    out.push({ kind: 'primary-key', action: !keyNow.length ? 'remove' : !keyWas.length ? 'add' : 'change', text, columns: keyNow, was: keyWas });
  }

  const renameIndex = (ix: Index): Index => ({ ...ix, parts: ix.parts.map((p) => (p.kind === 'column' ? { ...p, value: rename(p.value) } : p)) });
  const ixWas = was.indexes.map((ix, position) => ({ ix, key: indexKey(renameIndex(ix)), position })).filter((x) => !x.ix.pk);
  const ixNow = now.indexes.map((ix, position) => ({ ix, key: indexKey(ix), position })).filter((x) => !x.ix.pk);
  const ixText = (ix: Index) => `${ix.unique ? 'unique index' : 'index'}${ix.name ? ` ${dbmlName(ix.name)}` : ''} on ${ix.parts.length === 1 ? indexParts(ix)[0] : `(${indexParts(ix).join(', ')})`}`;
  for (const x of ixWas) if (!ixNow.some((y) => y.key === x.key && y.ix.name === x.ix.name)) out.push({ kind: 'index-removed', action: 'remove', text: `Removed ${ixText(x.ix)}`, index: x.ix, position: x.position });
  for (const x of ixNow) if (!ixWas.some((y) => y.key === x.key && y.ix.name === x.ix.name)) out.push({ kind: 'index-added', action: 'add', text: `Added ${ixText(x.ix)}`, index: x.ix, position: x.position });

  const checkKey = (c: Check) => `${c.name ?? ''}|${c.expression}`;
  for (const c of was.checks) if (!now.checks.some((x) => checkKey(x) === checkKey(c))) out.push({ kind: 'check-removed', action: 'remove', text: `Removed check \`${c.expression}\``, check: c });
  for (const c of now.checks) if (!was.checks.some((x) => checkKey(x) === checkKey(c))) out.push({ kind: 'check-added', action: 'add', text: `Added check \`${c.expression}\``, check: c });

  const records = (s: DbmlSchema, t: Table) => s.records.filter((r) => r.schema === t.schema && r.table === t.name).map((r) => [r.columns, r.rows, r.example]);
  if (!same(records(older, was), records(newer, now))) out.push({ kind: 'records', action: 'change', text: `Changed the records of ${dbmlName(now.name)}` });
  return out;
}

/** The changes from `older` to `newer`. */
export function diffSchemas(older: DbmlSchema, newer: DbmlSchema): SchemaDiff {
  const key = (t: { schema: string; name: string }) => tableKey(t.schema, t.name);
  const oldTables = new Map(older.tables.map((t) => [key(t), t]));
  const newTables = new Map(newer.tables.map((t) => [key(t), t]));
  const gone = older.tables.filter((t) => !newTables.has(key(t)));
  const come = newer.tables.filter((t) => !oldTables.has(key(t)));
  const renames = new Map(pairUnique(gone, come, (a, b) => a.schema === b.schema && signature(a) === signature(b)).map(([a, b]) => [b, a]));
  const wasOf = (t: Table) => oldTables.get(key(t)) ?? renames.get(t);
  const renamedFrom = new Set(renames.values());

  const groups = new Map<string, TableDiff>();
  const groupFor = (t: { schema: string; name: string }, status: TableDiff['status'], o?: Table, n?: Table) => {
    let g = groups.get(key(t));
    if (!g) groups.set(key(t), (g = { schema: t.schema, name: t.name, status, older: o, newer: n, changes: [] }));
    return g;
  };
  for (const t of newer.tables) {
    const was = wasOf(t);
    if (!was) groupFor(t, 'added', undefined, t).changes.push({ kind: 'table-added', action: 'add', text: `Added table ${nameOf(t.schema, t.name)}` });
    else {
      const changes = tableChanges(was, t, older, newer);
      if (was !== oldTables.get(key(t))) changes.unshift({ kind: 'table-renamed', action: 'change', text: `Renamed table ${dbmlName(was.name)} to ${dbmlName(t.name)}` });
      if (changes.length) groupFor(t, was === oldTables.get(key(t)) ? 'changed' : 'renamed', was, t).changes.push(...changes);
    }
  }
  for (const t of gone) if (!renamedFrom.has(t)) groupFor(t, 'removed', t).changes.push({ kind: 'table-removed', action: 'remove', text: `Removed table ${nameOf(t.schema, t.name)}` });

  // Older refs are read through the renames, so a ref to a renamed table or column is the same ref.
  const tableNow = new Map([...renames].map(([now, was]) => [key(was), now]));
  const columnNow = (schema: string, table: string, column: string) => {
    const now = tableNow.get(tableKey(schema, table)) ?? newTables.get(tableKey(schema, table));
    const g = now && groups.get(key(now));
    const r = g?.changes.find((c) => c.kind === 'column-renamed' && c.was.name === column);
    return r && r.kind === 'column-renamed' ? r.column.name : column;
  };
  const through = (r: Ref): Ref => {
    const end = (e: Ref['from']) => ({ schema: e.schema, table: tableNow.get(tableKey(e.schema, e.table))?.name ?? e.table, columns: e.columns.map((c) => columnNow(e.schema, e.table, c)) });
    return { ...r, from: end(r.from), to: end(r.to) };
  };
  const refGroup = (r: Ref) => {
    const k = tableKey(r.from.schema, r.from.table);
    const now = newTables.get(k);
    if (now) return groupFor(now, 'changed', wasOf(now), now);
    const was = oldTables.get(k);
    return groupFor(was ?? { schema: r.from.schema, name: r.from.table }, 'removed', was);
  };
  const oldRefs = older.refs.map((r) => ({ r, k: refKey(through(r)), mapped: through(r) }));
  const newRefs = newer.refs.map((r) => ({ r, k: refKey(r) }));
  const matched = new Set<number>();
  for (const n of newRefs) {
    const i = oldRefs.findIndex((o, j) => !matched.has(j) && o.k === n.k);
    if (i < 0) {
      refGroup(n.r).changes.push({ kind: 'ref-added', action: 'add', text: `Added ref ${refText(n.r)}`, ref: n.r });
      continue;
    }
    matched.add(i);
    const o = oldRefs[i]!;
    const details = refDetails(o.mapped, n.r);
    if (details.length) refGroup(n.r).changes.push({ kind: 'ref-changed', action: 'change', text: `Changed ref ${refText(n.r)}: ${details.join(', ')}`, ref: n.r, was: o.r });
  }
  oldRefs.forEach((o, i) => {
    if (!matched.has(i)) refGroup(o.mapped).changes.push({ kind: 'ref-removed', action: 'remove', text: `Removed ref ${refText(o.mapped)}`, ref: o.r });
  });

  const enums: SchemaChange[] = [];
  const enumKey = (e: DbmlEnum) => tableKey(e.schema, e.name);
  const enumName = (e: DbmlEnum) => nameOf(e.schema, e.name);
  for (const e of newer.enums) {
    const was = older.enums.find((x) => enumKey(x) === enumKey(e));
    if (!was) {
      enums.push({ kind: 'enum-added', action: 'add', text: `Added enum ${enumName(e)}`, enum: e });
      continue;
    }
    const [a, b] = [was.values.map((v) => v.name), e.values.map((v) => v.name)];
    for (const v of b.filter((v) => !a.includes(v))) enums.push({ kind: 'enum-value-added', action: 'add', text: `Added value '${v}' to enum ${enumName(e)}`, enum: e, value: v });
    for (const v of a.filter((v) => !b.includes(v))) enums.push({ kind: 'enum-value-removed', action: 'remove', text: `Removed value '${v}' from enum ${enumName(e)}`, enum: e, value: v });
  }
  for (const e of older.enums) if (!newer.enums.some((x) => enumKey(x) === enumKey(e))) enums.push({ kind: 'enum-removed', action: 'remove', text: `Removed enum ${enumName(e)}`, enum: e });

  const other: SchemaChange[] = [];
  const named = <T extends { name: string }>(was: T[], now: T[], word: string, k: 'group' | 'sticky-note', shape: (x: T) => unknown) => {
    for (const x of now) {
      const w = was.find((y) => y.name === x.name);
      if (!w) other.push({ kind: `${k}-added` as const, action: 'add', text: `Added ${word} ${dbmlName(x.name)}`, name: x.name });
      else if (!same(shape(w), shape(x))) other.push({ kind: `${k}-changed` as const, action: 'change', text: `Changed ${word} ${dbmlName(x.name)}`, name: x.name });
    }
    for (const w of was) if (!now.some((y) => y.name === w.name)) other.push({ kind: `${k}-removed` as const, action: 'remove', text: `Removed ${word} ${dbmlName(w.name)}`, name: w.name });
  };
  named(older.groups, newer.groups, 'group', 'group', (g) => [g.tables.map((t) => tableNow.get(tableKey(t.schema, t.name))?.name ?? t.name), g.note, g.color]);
  named(older.notes, newer.notes, 'sticky note', 'sticky-note', (n) => n.text);
  if (older.project?.note !== newer.project?.note) other.push({ kind: 'project-note', action: newer.project?.note == null ? 'remove' : older.project?.note == null ? 'add' : 'change', text: `${newer.project?.note == null ? 'Removed' : older.project?.note == null ? 'Added' : 'Changed'} the project note` });

  const order = [...newer.tables.map(key), ...gone.map(key)];
  const tables = [...groups.values()].filter((g) => g.changes.length).sort((a, b) => order.indexOf(tableKey(a.schema, a.name)) - order.indexOf(tableKey(b.schema, b.name)));
  return { tables, enums, other, changes: [...tables.flatMap((t) => t.changes), ...enums, ...other] };
}

/** A line of a side-by-side diff: `a` and `b` are its 1-based line numbers in each text. */
export interface LineOp {
  op: 'same' | 'added' | 'removed';
  text: string;
  a?: number;
  b?: number;
}

/** Beyond this many cells the middle of the texts is shown as removed then added, rather than matched line by line. */
const LCS_LIMIT = 4000 * 4000;

/** The lines of `b` against those of `a`: a longest common subsequence after trimming what both start and end with. */
export function diffLines(a: string, b: string): LineOp[] {
  const x = a.split('\n');
  const y = b.split('\n');
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let end = 0;
  while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  const out: LineOp[] = [];
  const keep = (i: number, j: number) => out.push({ op: 'same', text: x[i]!, a: i + 1, b: j + 1 });
  for (let i = 0; i < start; i++) keep(i, i);
  const xs = x.slice(start, x.length - end);
  const ys = y.slice(start, y.length - end);
  const [n, m] = [xs.length, ys.length];
  if (n * m > LCS_LIMIT) {
    xs.forEach((t, i) => out.push({ op: 'removed', text: t, a: start + i + 1 }));
    ys.forEach((t, j) => out.push({ op: 'added', text: t, b: start + j + 1 }));
  } else {
    // lengths[i * (m + 1) + j]: the LCS of xs[i..] and ys[j..].
    const lengths = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) lengths[i * (m + 1) + j] = xs[i] === ys[j] ? lengths[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lengths[(i + 1) * (m + 1) + j]!, lengths[i * (m + 1) + j + 1]!);
    let [i, j] = [0, 0];
    while (i < n || j < m) {
      if (i < n && j < m && xs[i] === ys[j]) {
        keep(start + i++, start + j++);
      } else if (i < n && (j >= m || lengths[(i + 1) * (m + 1) + j]! >= lengths[i * (m + 1) + j + 1]!)) out.push({ op: 'removed', text: xs[i]!, a: start + ++i });
      else out.push({ op: 'added', text: ys[j]!, b: start + ++j });
    }
  }
  for (let k = end; k > 0; k--) keep(x.length - k, y.length - k);
  return out;
}
