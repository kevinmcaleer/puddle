// The script that takes a database from a saved version of the schema to the current one, built from the diff
// (src/schema/diff.ts) with the same writers as the export (script.ts). Statements run in an order every database can
// follow: constraints that go are dropped first (under their old names), then new schemas and enum types, renames,
// added and changed columns, dropped columns, new tables (parents first), the keys, checks, indexes and foreign keys
// that come, and dropped tables (children first) and types last. What a database can't do in place is written as a
// `-- By hand:` comment and a warning, never as SQL that would fail; whatever loses data has a `-- Loses data:` line.
import { diffSchemas, enumOf, qualified, tableKey, type Column, type DbmlSchema, type Ref, type ChangeOf, type SchemaChange, type Table, type TableDiff } from '../../schema';
import type { DdlDialect } from '../sql';
import { foreignKey, primaryKey } from './duckdb';
import { DIALECT_RULES } from './export';
import { indexName, ordered, scriptWriter, withJunctions, type ColumnSql } from './script';
import { typeKind, type TypeKind } from './types';

export interface Migration {
  sql: string;
  /** What the script leaves to be done by hand, or may refuse, in a sentence each. */
  warnings: string[];
  /** The statements that lose data, in a sentence each: `Drops column orders.legacy_code`. */
  lossy: string[];
}

const TEXT_KINDS = new Set<TypeKind['kind']>(['varchar', 'char', 'text', 'json']);
const INT_DIGITS = { 1: 3, 2: 5, 4: 10, 8: 19 } as const;

/** Whether changing a column from one type to another can lose or refuse what it holds: anything not known to widen. */
export function narrows(older: DbmlSchema, newer: DbmlSchema, a: Column, b: Column): boolean {
  const [ea, eb] = [enumOf(older, a), enumOf(newer, b)];
  if (ea && eb) return !ea.values.every((v) => eb.values.some((x) => x.name === v.name));
  if (eb) return true;
  const [x, y] = [typeKind(a.type), typeKind(b.type)];
  if (ea) return !!y && TEXT_KINDS.has(y.kind) && 'length' in y && y.length != null;
  if (!x || !y) return a.type.trim().toLowerCase() !== b.type.trim().toLowerCase();
  const length = (t: TypeKind) => (t.kind === 'varchar' || t.kind === 'char' ? (t.length ?? Infinity) : t.kind === 'text' || t.kind === 'json' ? Infinity : undefined);
  if (TEXT_KINDS.has(y.kind)) return length(y)! < (TEXT_KINDS.has(x.kind) ? length(x)! : Infinity) || (!TEXT_KINDS.has(x.kind) && length(y) !== Infinity);
  if (TEXT_KINDS.has(x.kind)) return true;
  if (x.kind === 'int' && y.kind === 'int') return y.bytes < x.bytes;
  if (x.kind === 'int' && y.kind === 'decimal') return y.precision != null && y.precision - (y.scale ?? 0) < INT_DIGITS[x.bytes];
  if (x.kind === 'int' && y.kind === 'double') return x.bytes > 4;
  if (x.kind === 'decimal' && y.kind === 'decimal') return (y.precision ?? Infinity) - (y.scale ?? 0) < (x.precision ?? Infinity) - (x.scale ?? 0) || (y.scale ?? Infinity) < (x.scale ?? Infinity);
  if (x.kind === 'float' && y.kind === 'double') return false;
  if (x.kind === 'date' && (y.kind === 'timestamp' || y.kind === 'timestamptz')) return false;
  if (x.kind === 'timestamp' && y.kind === 'timestamptz') return false;
  return x.kind !== y.kind;
}

/** The statements that take a database built from `older` to `newer`. */
export function migrationSql(olderInput: DbmlSchema, newerInput: DbmlSchema, dialect: DdlDialect): Migration {
  const rules = DIALECT_RULES[dialect];
  const older = withJunctions(olderInput);
  const newer = withJunctions(newerInput);
  const diff = diffSchemas(older, newer);
  // `now` writes what the script runs, and its warnings are the script's; `was` and `peek` only compare.
  const now = scriptWriter(newer, rules);
  const was = scriptWriter(older, rules);
  const peek = scriptWriter(newer, rules);
  const { q, s, ref, warnings } = now;
  const label = rules.label;
  const lossy: string[] = [];
  const out: string[] = [`-- ${label} migration made by Puddle from the saved version to the project's DBML`];
  let lines: string[] = [];
  const section = (write: () => void) => {
    lines = [];
    write();
    if (lines.length) out.push('', ...lines);
  };
  const emit = (...statements: string[]) => lines.push(...statements);
  const byHand = (text: string) => {
    lines.push(`-- By hand: ${text}`);
    warnings.push(text);
  };
  const losing = (what: string, ...statements: string[]) => {
    lossy.push(what);
    lines.push(`-- Loses data: ${what.charAt(0).toLowerCase()}${what.slice(1)}`, ...statements);
  };

  const name = (t: { schema: string; name: string }) => qualified(t.schema, t.name);
  const tref = (t: { schema: string; name: string } | { schema: string; table: string }) => ref(t.schema, 'name' in t ? t.name : t.table);
  const changed = diff.tables.filter((g): g is TableDiff & { older: Table; newer: Table } => !!g.older && !!g.newer);
  const removed = diff.tables.filter((g) => g.status === 'removed' && g.older).map((g) => g.older!);
  const added = new Set(diff.tables.filter((g) => g.status === 'added').map((g) => g.newer!));
  const removedKeys = new Set(removed.map((t) => tableKey(t.schema, t.name)));
  const of = <K extends SchemaChange['kind']>(g: TableDiff, kind: K) => g.changes.filter((c): c is ChangeOf<K> => c.kind === kind);
  const all = <K extends SchemaChange['kind']>(kind: K) => diff.changes.filter((c): c is ChangeOf<K> => c.kind === kind);
  const findIn = (schema: DbmlSchema, e: { schema: string; table: string }) => schema.tables.find((t) => t.schema === e.schema && t.name === e.table);

  const oldLoops = ordered(older).loops;
  /** Whether the export of `older` made this ref a foreign key. */
  const madeBefore = (r: Ref) => {
    const fk = foreignKey(r);
    if (!fk || !findIn(older, fk.child) || !findIn(older, fk.parent)) return false;
    if (rules.inlineForeignKeys === 'parents-first' && oldLoops.has(r)) return false;
    return !(rules.foreignKeysAcrossSchemas === false && fk.parent.schema !== fk.child.schema);
  };
  const fkWords = (r: Ref) => {
    const fk = foreignKey(r)!;
    return `the foreign key from ${qualified(fk.child.schema, fk.child.table)} to ${qualified(fk.parent.schema, fk.parent.table)}`;
  };
  const ddlKey = (r: Ref) => {
    const fk = foreignKey(r);
    return fk ? JSON.stringify([r.name ?? '', r.delete ?? '', r.update ?? '', fk.child.columns.length, fk.child === r.from]) : 'none';
  };
  const refsChanged = all('ref-changed').filter((c) => ddlKey(c.was) !== ddlKey(c.ref));
  const refsGone = [...all('ref-removed').map((c) => c.ref), ...refsChanged.map((c) => c.was)];
  const refsCome = [...all('ref-added').map((c) => c.ref), ...refsChanged.map((c) => c.ref)];

  // DuckDB can't change a table that another table's foreign key points at (renames, types, nullability, dropped
  // columns), and the same for a table with indexes until they are dropped. Tables that go are dropped first there.
  const duck = dialect === 'duckdb';
  const pinnedBy = (t: Table) =>
    older.refs
      .filter((r) => madeBefore(r) && foreignKey(r)!.parent.schema === t.schema && foreignKey(r)!.parent.table === t.name)
      .map((r) => foreignKey(r)!.child)
      .filter((c) => !removedKeys.has(tableKey(c.schema, c.table)) && !(c.schema === t.schema && c.table === t.name))
      .map((c) => qualified(c.schema, c.table));
  const pinned = (g: TableDiff & { older: Table }) => (duck ? [...new Set(pinnedBy(g.older))] : []);
  const blocked = (g: TableDiff & { older: Table }, what: string) => {
    const by = pinned(g);
    if (!by.length) return false;
    byHand(`DuckDB can’t ${what} while foreign keys from ${by.join(', ')} point at ${name(g.older)}: rebuild those tables without them first.`);
    return true;
  };

  /** Each column in both versions, as it was and as it is. */
  const pairs = (g: TableDiff & { older: Table; newer: Table }) =>
    g.newer.columns.flatMap((c) => {
      const renamed = of(g, 'column-renamed').find((x) => x.column.name === c.name);
      const before = renamed ? renamed.was : g.older.columns.find((x) => x.name === c.name);
      return before && !of(g, 'column-added').some((x) => x.column.name === c.name) ? [{ before, after: c }] : [];
    });
  const written = (w: typeof now, t: Table, c: Column) => w.column(t, c).type;
  const typeChanged = (g: TableDiff & { older: Table; newer: Table }, p: { before: Column; after: Column }) => written(was, g.older, p.before) !== written(peek, g.newer, p.after);
  /** Whether DuckDB has to drop the table's indexes to change it. */
  const reindexed = new Set(
    duck
      ? changed.filter(
          (g) =>
            !pinned(g).length &&
            g.older.indexes.some((ix) => !ix.pk) &&
            (g.status === 'renamed' || g.changes.some((c) => ['column-renamed', 'column-null', 'column-removed'].includes(c.kind)) || pairs(g).some((p) => typeChanged(g, p)) || of(g, 'column-added').some((c) => c.column.notNull)),
        )
      : [],
  );

  // Constraints that go, under the names they were made with, before anything is renamed.
  section(() => {
    for (const r of refsGone) {
      const fk = foreignKey(r);
      if (!fk || !madeBefore(r) || removedKeys.has(tableKey(fk.child.schema, fk.child.table))) continue;
      const at = tref(fk.child);
      const pgName = `${fk.child.table}_${fk.child.columns.join('_')}_fkey`;
      if (dialect === 'sqlite' || duck) byHand(`${label} can’t drop ${fkWords(r)} in place: rebuild ${qualified(fk.child.schema, fk.child.table)} without it.`);
      else if (r.name || dialect === 'postgres') emit(`ALTER TABLE ${at} DROP ${dialect === 'mysql' ? 'FOREIGN KEY' : 'CONSTRAINT'} ${q(r.name ?? pgName)};`);
      else byHand(`${fkWords(r)} has no name in the DBML: look up the name ${label} gave it and drop it.`.replace(/^t/, 'T'));
    }
    for (const g of changed) {
      const at = tref(g.older);
      const t = g.older.name;
      const dropIndex = (ixName: string) => emit(dialect === 'mysql' || dialect === 'sqlserver' ? `DROP INDEX ${q(ixName)} ON ${at};` : `DROP INDEX ${ref(g.older.schema, ixName)};`);
      if (reindexed.has(g)) g.older.indexes.forEach((ix, i) => !ix.pk && dropIndex(indexName(g.older, ix, i)));
      else for (const c of of(g, 'index-removed')) dropIndex(indexName(g.older, c.index, c.position));
      const constraint = (what: string, pg: string | undefined, mysql: string | undefined) => {
        if (dialect === 'postgres' && pg) emit(`ALTER TABLE ${at} DROP CONSTRAINT ${q(pg)};`);
        else if (dialect === 'mysql' && mysql) emit(`ALTER TABLE ${at} DROP ${mysql};`);
        else if (dialect === 'sqlite' || duck) byHand(`${label} can’t drop ${what} in place: rebuild ${name(g.older)} without it.`);
        else byHand(`Look up the name ${label} gave ${what} and drop it.`);
      };
      for (const c of of(g, 'primary-key')) if (c.was.length) constraint(`the primary key of ${name(g.older)}`, `${t}_pkey`, 'PRIMARY KEY');
      for (const c of of(g, 'column-unique')) if (c.action === 'remove') constraint(`the unique constraint on ${name(g.older)}.${c.was.name}`, `${t}_${c.was.name}_key`, `INDEX ${q(c.was.name)}`);
      for (const c of of(g, 'column-check'))
        if (c.action === 'remove') constraint(`the check \`${c.check}\` on ${name(g.older)}.${c.was.name}`, `${t}_${c.was.name}_check`, undefined);
      for (const c of of(g, 'check-removed')) {
        const n = c.check.name;
        if (n && dialect !== 'sqlite' && !duck) emit(`ALTER TABLE ${at} DROP ${dialect === 'mysql' ? 'CHECK' : 'CONSTRAINT'} ${q(n)};`);
        else constraint(`the check \`${c.check.expression}\` on ${name(g.older)}`, undefined, undefined);
      }
    }
  });

  const dropTables = () => {
    const gone = ordered(older).tables.filter((t) => removed.includes(t)).reverse();
    for (const t of gone) {
      if (duck && pinnedBy(t).length) {
        byHand(`DuckDB can’t drop ${name(t)} while foreign keys from ${pinnedBy(t).join(', ')} point at it: rebuild those tables without them first.`);
        continue;
      }
      losing(`Drops table ${name(t)}`, `DROP TABLE ${tref(t)};`);
      if (duck)
        for (const c of t.columns.filter((x) => x.increment)) {
          const inc = rules.increment(written(was, t, c), { table: t, column: c, tableRef: tref(t), single: primaryKey(t).length === 1 });
          emit(...(inc?.before ?? []).map((b) => b.replace('CREATE SEQUENCE IF NOT EXISTS', 'DROP SEQUENCE IF EXISTS')));
        }
    }
  };
  if (duck) section(dropTables);

  // New schemas and enum types, and values added to enums.
  section(() => {
    if (rules.schemas !== 'none') {
      const spaces = (x: DbmlSchema) => new Set([...x.tables.map((t) => t.schema), ...(rules.enums === 'type' ? x.enums.map((e) => e.schema) : [])]);
      const before = spaces(older);
      const create = rules.schemas.create;
      for (const sch of spaces(newer)) if (sch !== 'public' && !before.has(sch)) emit(...create(q(sch)));
    }
    if (rules.enums === 'type') for (const c of all('enum-added')) emit(`CREATE TYPE ${now.enumRef(c.enum)} AS ENUM (${c.enum.values.map((v) => s(v.name)).join(', ')});`);
    for (const c of [...all('enum-value-added'), ...all('enum-value-removed')]) {
      const e = qualified(c.enum.schema, c.enum.name);
      const users = newer.tables.flatMap((t) => t.columns.filter((x) => enumOf(newer, x) === c.enum).map((x) => `${name(t)}.${x.name}`));
      if (dialect === 'postgres' && c.kind === 'enum-value-added') {
        const values = c.enum.values.map((v) => v.name);
        const prev = values[values.indexOf(c.value) - 1];
        emit(`ALTER TYPE ${now.enumRef(c.enum)} ADD VALUE ${s(c.value)}${prev ? ` AFTER ${s(prev)}` : ''};`);
      } else if (rules.enums === 'type') byHand(`${label} can’t ${c.kind === 'enum-value-added' ? `add the value '${c.value}' to` : `remove the value '${c.value}' from`} enum ${e}: make a new type with the values and change the columns that use it.`);
      else if (rules.enums === 'check' && users.length)
        byHand(`${label} writes enum ${e} as a check on ${users.join(', ')}: ${dialect === 'sqlite' ? 'rebuild those tables' : 'drop those checks and add them again'} with the values ${c.enum.values.map((v) => `'${v.name}'`).join(', ')}.`);
    }
  });

  // Renames: tables, then columns.
  section(() => {
    for (const g of changed.filter((x) => x.status === 'renamed')) {
      if (blocked(g, `rename ${name(g.older)} to ${g.newer.name}`)) continue;
      if (dialect === 'sqlserver') emit(`EXEC sp_rename ${s(name(g.older))}, ${s(g.newer.name)};`);
      else emit(`ALTER TABLE ${tref(g.older)} RENAME TO ${dialect === 'mysql' ? tref(g.newer) : q(g.newer.name)};`);
    }
    for (const g of changed)
      for (const c of of(g, 'column-renamed')) {
        if (blocked(g, `rename column ${c.was.name} of ${name(g.newer)} to ${c.column.name}`)) continue;
        if (dialect === 'sqlserver') emit(`EXEC sp_rename ${s(`${name(g.newer)}.${c.was.name}`)}, ${s(c.column.name)}, 'COLUMN';`);
        else emit(`ALTER TABLE ${tref(g.newer)} RENAME COLUMN ${q(c.was.name)} TO ${q(c.column.name)};`);
      }
  });

  // Added columns. SQLite and DuckDB take fewer constraints in ADD COLUMN; the rest follow later.
  const uniqueLater: { t: Table; column: string }[] = [];
  const referencedInline = new Set<Ref>();
  const constant = (c: Column) => !!c.default && c.default.kind !== 'expression';
  section(() => {
    for (const g of changed)
      for (const { column: c } of of(g, 'column-added')) {
        const at = tref(g.newer);
        const def = now.column(g.newer, c);
        const plain: ColumnSql = { ...def, primaryKey: false };
        if (c.notNull && !c.default && !c.increment && !c.pk) warnings.push(`${name(g.newer)}.${c.name} is not null with no default: adding it fails if ${name(g.newer)} has rows.`);
        if (dialect === 'sqlite') {
          if (def.unique) uniqueLater.push({ t: g.newer, column: c.name });
          let clause = def.clause;
          if (c.default?.kind === 'expression') {
            byHand(`SQLite can’t add a column with the default \`${c.default.value}\`: ${name(g.newer)}.${c.name} is added without it.`);
            clause = undefined;
          }
          const notNull = def.notNull && constant(c) && c.default?.kind !== 'null';
          if (def.notNull && !notNull) byHand(`SQLite can’t add a not null column without a default: ${name(g.newer)}.${c.name} is added nullable.`);
          let text = now.columnText({ ...plain, clause, notNull, unique: false });
          const r = refsCome.find((x) => {
            const fk = foreignKey(x);
            return fk && fk.child.schema === g.newer.schema && fk.child.table === g.newer.name && fk.child.columns.length === 1 && fk.child.columns[0] === c.name && findIn(newer, fk.parent);
          });
          if (r) {
            referencedInline.add(r);
            text += ` ${now.fkSql(r).replace(/FOREIGN KEY \([^)]*\) /, '')}`;
          }
          emit(`ALTER TABLE ${at} ADD COLUMN ${text};`);
        } else if (duck) {
          emit(...(def.increment?.before ?? []), `ALTER TABLE ${at} ADD COLUMN ${now.columnText({ ...plain, notNull: false, unique: false, checks: [] })};`);
          if (def.notNull && !blocked(g, `make the new column ${c.name} not null`)) emit(`ALTER TABLE ${at} ALTER COLUMN ${q(c.name)} SET NOT NULL;`);
          if (def.unique) uniqueLater.push({ t: g.newer, column: c.name });
          for (const x of def.checks) byHand(`DuckDB can’t add the check \`${x}\` to an existing table: rebuild ${name(g.newer)} with it.`);
        } else emit(`ALTER TABLE ${at} ADD${dialect === 'sqlserver' ? '' : ' COLUMN'} ${now.columnText(plain)};`);
      }
  });

  // Changed columns: type, nullability, default, increment (and, in MySQL, the comment), in each database's words.
  section(() => {
    for (const g of changed) {
      const at = tref(g.newer);
      for (const p of pairs(g)) {
        const kinds = new Set(g.changes.filter((c) => 'column' in c && 'was' in c && c.column === p.after).map((c) => c.kind));
        const retyped = typeChanged(g, p);
        const def = now.column(g.newer, p.after);
        const col = `${name(g.newer)}.${p.after.name}`;
        const typeWords = `${p.before.type} to ${p.after.type}`;
        const narrowing = retyped && narrows(older, newer, p.before, p.after);
        const nulls = kinds.has('column-null');
        const defaults = kinds.has('column-default') && !def.increment;
        const increments = kinds.has('column-increment');
        if (dialect === 'mysql') {
          if (!retyped && !nulls && !defaults && !increments && !kinds.has('column-note')) continue;
          const stmt = `ALTER TABLE ${at} MODIFY COLUMN ${now.columnText({ ...def, primaryKey: false, notNull: def.notNull || def.primaryKey, unique: false, checks: [] })};`;
          if (narrowing) losing(`Narrows ${col} from ${typeWords}`, stmt);
          else emit(stmt);
          continue;
        }
        if (dialect === 'sqlite') {
          const what = [retyped && `type ${typeWords}`, nulls && (p.after.notNull ? 'not null' : 'nullable'), defaults && 'default', increments && 'increment'].filter(Boolean);
          if (what.length) byHand(`SQLite can’t change ${col} in place (${what.join(', ')}): rebuild ${name(g.newer)} — create it anew, copy the rows across, drop the old table and rename the new one.`);
          continue;
        }
        if (retyped && !blocked(g, `change the type of ${col} from ${typeWords}`)) {
          const stmt =
            dialect === 'sqlserver'
              ? `ALTER TABLE ${at} ALTER COLUMN ${q(p.after.name)} ${def.type} ${def.notNull || def.primaryKey ? 'NOT NULL' : 'NULL'};`
              : `ALTER TABLE ${at} ALTER COLUMN ${q(p.after.name)} TYPE ${def.type}${dialect === 'postgres' ? ` USING ${q(p.after.name)}::${def.type}` : ''};`;
          if (narrowing) losing(`Narrows ${col} from ${typeWords}`, stmt);
          else emit(stmt);
        }
        if (nulls && !(dialect === 'sqlserver' && retyped) && !blocked(g, `make ${col} ${p.after.notNull ? 'not null' : 'nullable'}`)) {
          if (dialect === 'sqlserver') emit(`ALTER TABLE ${at} ALTER COLUMN ${q(p.after.name)} ${def.type} ${p.after.notNull ? 'NOT NULL' : 'NULL'};`);
          else emit(`ALTER TABLE ${at} ALTER COLUMN ${q(p.after.name)} ${p.after.notNull ? 'SET' : 'DROP'} NOT NULL;`);
        }
        if (defaults) {
          if (dialect === 'sqlserver') {
            if (p.before.default) byHand(`Look up the name SQL Server gave the default of ${col} and drop it${p.after.default ? '; then run the ADD DEFAULT below' : ''}.`);
            if (p.after.default) emit(`ALTER TABLE ${at} ADD DEFAULT ${now.defaultSql(p.after.default)} FOR ${q(p.after.name)};`);
          } else emit(`ALTER TABLE ${at} ALTER COLUMN ${q(p.after.name)} ${p.after.default ? `SET DEFAULT ${now.defaultSql(p.after.default)}` : 'DROP DEFAULT'};`);
        }
        if (increments) {
          const inc = def.increment;
          if (dialect === 'sqlserver') byHand(`SQL Server can’t ${p.after.increment ? 'add IDENTITY to' : 'remove IDENTITY from'} ${col}: rebuild ${name(g.newer)}.`);
          else if (!p.after.increment) emit(`ALTER TABLE ${at} ALTER COLUMN ${q(p.after.name)} ${dialect === 'postgres' ? 'DROP IDENTITY IF EXISTS' : 'DROP DEFAULT'};`);
          else if (inc) emit(...(inc.before ?? []), `ALTER TABLE ${at} ALTER COLUMN ${q(p.after.name)} ${inc.clause.startsWith('DEFAULT ') ? `SET ${inc.clause}` : `ADD ${inc.clause}`};`);
        }
      }
    }
  });

  // Dropped columns.
  section(() => {
    for (const g of changed)
      for (const { was: c } of of(g, 'column-removed')) {
        const col = `${name(g.newer)}.${c.name}`;
        if (blocked(g, `drop column ${col}`)) continue;
        if (dialect === 'sqlite' && (c.pk || c.unique || g.older.indexes.some((ix) => ix.parts.some((p) => p.value === c.name)) || older.refs.some((r) => madeBefore(r) && foreignKey(r)!.child.table === g.older.name && foreignKey(r)!.child.columns.includes(c.name)))) {
          byHand(`SQLite can’t drop ${col} while a key, index or foreign key uses it: rebuild ${name(g.newer)} without it.`);
          continue;
        }
        if (dialect === 'sqlserver' && c.default) byHand(`Look up the name SQL Server gave the default of ${col} and drop it before the column.`);
        losing(`Drops column ${col}`, `ALTER TABLE ${tref(g.newer)} DROP COLUMN ${q(c.name)};`);
      }
  });

  // New tables, parents first; their foreign keys come with the others below where the database adds them later.
  const { tables: newOrder, loops } = ordered(newer);
  const laterKeys: string[] = [];
  const comments: string[] = [];
  for (const t of newOrder.filter((x) => added.has(x))) {
    const x = now.table(t, loops);
    section(() => emit(...x.before, ...x.create, ...x.indexes));
    laterKeys.push(...x.foreignKeys);
    comments.push(...x.comments);
  }

  // Keys, checks, indexes and foreign keys that come, and notes.
  section(() => {
    for (const g of changed) {
      const at = tref(g.newer);
      for (const c of of(g, 'primary-key'))
        if (c.columns.length) {
          if (dialect === 'sqlite') byHand(`SQLite can’t add a primary key to an existing table: rebuild ${name(g.newer)} with PRIMARY KEY (${c.columns.join(', ')}).`);
          else emit(`ALTER TABLE ${at} ADD PRIMARY KEY (${c.columns.map(q).join(', ')});`);
        }
      for (const c of of(g, 'column-unique')) if (c.action === 'add') uniqueLater.push({ t: g.newer, column: c.column.name });
      const checks = [...of(g, 'column-check').filter((c) => c.action === 'add').map((c) => ({ text: c.check!, name: undefined as string | undefined })), ...of(g, 'check-added').map((c) => ({ text: c.check.expression, name: c.check.name }))];
      for (const c of checks) {
        if (dialect === 'sqlite' || duck) byHand(`${label} can’t add the check \`${c.text}\` to an existing table: rebuild ${name(g.newer)} with it.`);
        else emit(`ALTER TABLE ${at} ADD ${c.name ? `CONSTRAINT ${q(c.name)} ` : ''}CHECK (${c.text});`);
      }
    }
    for (const u of uniqueLater) {
      if (dialect === 'sqlite' || duck) emit(`CREATE UNIQUE INDEX ${q(`${u.t.name}_${u.column}_key`)} ON ${tref(u.t)} (${q(u.column)});`);
      else emit(`ALTER TABLE ${tref(u.t)} ADD UNIQUE (${q(u.column)});`);
    }
    for (const g of changed) {
      if (reindexed.has(g)) g.newer.indexes.forEach((ix, i) => !ix.pk && emit(now.indexSql(g.newer, ix, i)));
      else for (const c of of(g, 'index-added')) emit(now.indexSql(g.newer, c.index, c.position));
    }
    emit(...laterKeys);
    for (const r of refsCome) {
      const fk = foreignKey(r);
      if (!fk || referencedInline.has(r)) continue;
      const child = findIn(newer, fk.child);
      if (!child || added.has(child) || !findIn(newer, fk.parent)) continue;
      if (dialect === 'sqlite' || duck) byHand(`${label} can’t add a foreign key to an existing table: rebuild ${qualified(fk.child.schema, fk.child.table)} with ${now.fkSql(r)}.`);
      else emit(`ALTER TABLE ${tref(child)} ADD ${now.fkSql(r)};`);
    }
    if (rules.comments === 'comment-on') {
      emit(...comments);
      for (const g of changed) {
        if (of(g, 'table-note').length) emit(`COMMENT ON TABLE ${tref(g.newer)} IS ${g.newer.note != null ? s(g.newer.note) : 'NULL'};`);
        for (const c of of(g, 'column-note')) emit(`COMMENT ON COLUMN ${tref(g.newer)}.${q(c.column.name)} IS ${c.column.note != null ? s(c.column.note) : 'NULL'};`);
      }
    } else if (rules.comments === 'clause') for (const g of changed) if (of(g, 'table-note').length) emit(`ALTER TABLE ${tref(g.newer)} COMMENT = ${s(now.oneLine(g.newer.note ?? ''))};`);
  });

  if (!duck) section(dropTables);
  if (rules.enums === 'type') section(() => all('enum-removed').forEach((c) => emit(`DROP TYPE ${was.enumRef(c.enum)};`)));

  if (out.length === 1) out.push('', '-- Nothing to change.');
  return { sql: `${out.join('\n')}\n`, warnings: [...new Set(warnings)], lossy };
}
