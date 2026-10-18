// The SQL DDL importer: reads a script's CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE TYPE … AS ENUM and comment
// statements into the schema model, and counts every other statement it skips by kind. It is tolerant: what it can't
// read inside a table becomes a warning, and the rest of the script still imports.
import { emptySchema, type DbmlEnum, type DbmlSchema, type Ref, type Table } from '../model';
import { Cursor, splitTop } from './cursor';
import { DEFAULT_SCHEMAS, detectDialect, type SqlDialect } from './dialect';
import { splitStatements, type Statement, type Token } from './lexer';
import { addKey, atConstraint, columnOf, indexParts, readColumn, readConstraint, readDefault, type PendingRef, type TableContext } from './table';

/** A problem the importer worked around, at a 1-based line of the script. */
export interface SqlWarning {
  message: string;
  line: number;
}

/** Statements of one kind the importer skipped: `INSERT`, `CREATE VIEW`. */
export interface SkippedStatements {
  kind: string;
  count: number;
}

export interface SqlImport {
  schema: DbmlSchema;
  /** The dialect read: the one asked for, or the one detected. */
  dialect: SqlDialect;
  /** Most frequent first. */
  skipped: SkippedStatements[];
  warnings: SqlWarning[];
}

const MODIFIERS = new Set(['OR', 'REPLACE', 'ALTER', 'TEMP', 'TEMPORARY', 'GLOBAL', 'LOCAL', 'UNLOGGED', 'UNIQUE', 'CLUSTERED', 'NONCLUSTERED', 'RECURSIVE', 'TRUSTED', 'PROCEDURAL']);

/** A statement's kind, as skipped statements are counted: `INSERT`, `CREATE VIEW`, `ALTER TABLE`. */
export function statementKind(statement: Statement): string {
  const up = (k: number) => (statement.tokens[k]?.kind === 'word' ? statement.tokens[k]!.value.toUpperCase() : '');
  const head = up(0);
  if (head === 'CREATE' || head === 'ALTER' || head === 'DROP') {
    let k = 1;
    while (MODIFIERS.has(up(k))) k++;
    const obj = up(k);
    if (obj === 'MATERIALIZED' || obj === 'FOREIGN') return `${head} ${obj} ${up(k + 1)}`.trim();
    return obj ? `${head} ${obj}` : head;
  }
  if (head === 'LOCK' || head === 'UNLOCK' || head === 'COMMENT') return `${head} ${up(1)}`.trim();
  return head || 'unrecognised';
}

/** Reads a SQL script's schema. The dialect is detected from the script unless given. */
export function importSql(sql: string, dialect: SqlDialect = detectDialect(sql)): SqlImport {
  const schema = emptySchema();
  const warnings: SqlWarning[] = [];
  const skipped = new Map<string, number>();
  const refs: PendingRef[] = [];
  const defaults = DEFAULT_SCHEMAS[dialect];

  const resolve = (parts: string[]) => {
    const name = parts[parts.length - 1]!;
    const owner = parts.length > 1 ? parts[parts.length - 2]! : undefined;
    return { schema: owner === undefined || dialect === 'mysql' || defaults.includes(owner.toLowerCase()) ? 'public' : owner, name };
  };
  const ctx: TableContext = { dialect, refs, warn: (message, line) => warnings.push({ message, line }), resolve };
  const find = (parts: string[]): Table | undefined => {
    const { schema: s, name } = resolve(parts);
    const same = (t: Table) => t.schema.toLowerCase() === s.toLowerCase() && t.name.toLowerCase() === name.toLowerCase();
    return schema.tables.find((t) => t.schema === s && t.name === name) ?? schema.tables.find(same);
  };
  const missing = (parts: string[], line: number, what: string) => ctx.warn(`Skipped ${what}: there is no table "${parts.join('.')}" before it`, line);

  function createTable(c: Cursor, line: number): string | undefined {
    c.eat('IF', 'NOT', 'EXISTS');
    const parts = c.qualifiedName();
    if (!parts) return 'CREATE TABLE';
    if (c.eat('PARTITION', 'OF')) return 'CREATE TABLE PARTITION OF';
    const body = c.group();
    if (!body) return 'CREATE TABLE AS';
    const { schema: s, name } = resolve(parts);
    if (name.toLowerCase().startsWith('sqlite_')) return 'SQLite internal table';
    const table: Table = { schema: s, name, properties: {}, columns: [], indexes: [], checks: [], partials: [] };
    const earlier = find(parts);
    if (earlier) {
      ctx.warn(`Table "${name}" is created twice; the later one is kept`, line);
      schema.tables.splice(schema.tables.indexOf(earlier), 1);
    }
    const constraints: Cursor[] = [];
    for (const item of splitTop(body)) {
      const ic = new Cursor(item, c.source);
      if (atConstraint(ic)) constraints.push(ic);
      else if (ic.isWord('LIKE') || ic.isWord('PERIOD') || (ic.peek()?.kind !== 'word' && ic.peek()?.kind !== 'ident')) {
        ctx.warn(`Skipped an unrecognised line in table "${name}": ${ic.text(item).slice(0, 60)}`, ic.line);
      } else {
        const col = readColumn(ic, table, ctx);
        if (!col) continue;
        if (columnOf(table, col.name)) ctx.warn(`Table "${name}" has two columns called "${col.name}"; the first is kept`, ic.line);
        else table.columns.push(col);
      }
    }
    for (const ic of constraints) readConstraint(ic, table, ctx);
    while (!c.done) {
      if (c.eat('COMMENT')) {
        c.eatPunct('=');
        const t = c.next();
        if (t?.kind === 'string') table.note = t.value;
      } else c.next();
    }
    schema.tables.push(table);
    return undefined;
  }

  function createIndex(c: Cursor, line: number, other: string): string | undefined {
    const unique = c.eat('UNIQUE');
    while (c.eat('CLUSTERED') || c.eat('NONCLUSTERED'));
    const type = c.eat('FULLTEXT') ? 'fulltext' : c.eat('SPATIAL') ? 'spatial' : undefined;
    if (!c.eat('INDEX')) return other;
    c.eat('CONCURRENTLY');
    c.eat('IF', 'NOT', 'EXISTS');
    const key: Parameters<typeof addKey>[2] = { kind: unique ? 'unique' : 'index', parts: [], index: true };
    if (type) key.type = type;
    if (!c.isWord('ON')) {
      const n = c.qualifiedName();
      if (n) key.name = n[n.length - 1]!;
    }
    if (c.eat('USING')) key.type = c.name();
    c.eat('ON');
    c.eat('ONLY');
    const parts = c.qualifiedName() ?? [];
    if (c.eat('USING')) key.type = c.name();
    const cols = c.group();
    if (!cols) return 'CREATE INDEX';
    const table = find(parts);
    if (!table) {
      missing(parts, line, `index ${key.name ?? ''}`.trim());
      return undefined;
    }
    key.parts = indexParts(c, cols);
    if (c.tokens.slice(c.pos).some((t) => t.kind === 'word' && t.value.toUpperCase() === 'WHERE')) ctx.warn(`Left out the WHERE condition of index "${key.name ?? ''}" on table "${table.name}"`, line);
    addKey(table, ctx, key, line);
    return undefined;
  }

  function createType(c: Cursor): string | undefined {
    const parts = c.qualifiedName();
    if (!parts || !c.eat('AS', 'ENUM')) return 'CREATE TYPE';
    const { schema: s, name } = resolve(parts);
    const values = splitTop(c.group() ?? []).map((item) => ({ name: item[0]!.value }));
    const e: DbmlEnum = { schema: s, name, values };
    const earlier = schema.enums.findIndex((x) => x.schema === s && x.name === name);
    if (earlier >= 0) schema.enums.splice(earlier, 1);
    if (values.length) schema.enums.push(e);
    return undefined;
  }

  /** What an ALTER TABLE action does, when it is something the schema holds. */
  function alterKind(item: Token[]): 'add' | 'alter' | 'modify' | 'option' | undefined {
    const ac = new Cursor(item, '');
    if (ac.peek()?.kind === 'word' && (ac.isPunct('=', 1) || (ac.isWord('CHARSET', 1) && ac.isPunct('=', 2)) || (ac.isWord('COMMENT') && ac.peek(1)?.kind === 'string'))) return 'option';
    if (!ac.eat('WITH', 'CHECK')) ac.eat('WITH', 'NOCHECK');
    if (ac.isWord('ADD')) return 'add';
    if (ac.isWord('MODIFY') || ac.isWord('CHANGE')) return 'modify';
    if (!ac.eat('ALTER')) return undefined;
    ac.eat('COLUMN');
    ac.name();
    return (ac.isWord('SET') && (ac.isWord('DEFAULT', 1) || ac.isWord('NOT', 1))) || ac.isWord('DROP') || ac.isWord('ADD') ? 'alter' : undefined;
  }

  function alterTable(c: Cursor, line: number): string | undefined {
    c.eat('IF', 'EXISTS');
    c.eat('ONLY');
    const parts = c.qualifiedName();
    if (!parts) return 'ALTER TABLE';
    c.eatPunct('*');
    const actions = splitTop(c.rest());
    const comment = (a: Token[]) => a[0]!.kind === 'word' && a[0]!.value.toUpperCase() === 'COMMENT';
    if (!actions.some((a) => (alterKind(a) && alterKind(a) !== 'option') || comment(a))) return 'ALTER TABLE';
    const table = find(parts);
    if (!table) {
      missing(parts, line, 'ALTER TABLE');
      return undefined;
    }
    for (const action of actions) {
      const kind = alterKind(action);
      const ac = new Cursor(action, c.source);
      if (!kind) {
        ctx.warn(`Skipped part of an ALTER TABLE on table "${table.name}": ${ac.text(action).slice(0, 60)}`, action[0]!.line);
        continue;
      }
      if (kind === 'option') {
        // Table options (ENGINE=, AUTO_INCREMENT=): only a comment is something the schema holds.
        const value = action.find((t) => t.kind === 'string');
        if (comment(action) && value) table.note = value.value;
        continue;
      }
      if (!ac.eat('WITH', 'CHECK')) ac.eat('WITH', 'NOCHECK');
      if (ac.eat('ADD')) {
        if (atConstraint(ac) || ac.isWord('DEFAULT')) readConstraint(ac, table, ctx);
        else {
          ac.eat('COLUMN');
          ac.eat('IF', 'NOT', 'EXISTS');
          const col = readColumn(ac, table, ctx);
          if (col && !columnOf(table, col.name)) table.columns.push(col);
        }
      } else if (ac.eat('MODIFY') || ac.eat('CHANGE')) {
        const change = action[0]!.value.toUpperCase() === 'CHANGE';
        ac.eat('COLUMN');
        const old = change ? ac.name() : ac.peek()?.value;
        const col = readColumn(ac, table, ctx);
        const at = old !== undefined ? table.columns.indexOf(columnOf(table, old)!) : -1;
        if (col && at >= 0) {
          const before = table.columns[at]!;
          table.columns[at] = { ...col, pk: col.pk || before.pk, unique: col.unique || before.unique, ...(before.note !== undefined && col.note === undefined ? { note: before.note } : {}) };
        }
      } else {
        ac.eat('ALTER');
        ac.eat('COLUMN');
        const name = ac.name() ?? '';
        const col = columnOf(table, name);
        if (!col) {
          ctx.warn(`Skipped an ALTER TABLE on table "${table.name}": it has no column "${name}"`, action[0]!.line);
          continue;
        }
        if (ac.eat('SET', 'DEFAULT')) {
          const d = readDefault(ac.rest(), c.source);
          if (d.increment) col.increment = true;
          if (d.value) col.default = d.value;
        } else if (ac.eat('SET', 'NOT', 'NULL')) col.notNull = true;
        else if (ac.eat('DROP', 'NOT', 'NULL')) delete col.notNull;
        else if (ac.eat('DROP', 'DEFAULT')) delete col.default;
        else if (ac.eat('ADD', 'GENERATED')) col.increment = true;
      }
    }
    return undefined;
  }

  function commentOn(c: Cursor, line: number): string | undefined {
    const onTable = c.eat('TABLE');
    if (!onTable && !c.eat('COLUMN')) return 'COMMENT ON';
    const parts = c.qualifiedName() ?? [];
    const tableParts = onTable ? parts : parts.slice(0, -1);
    if (!c.eat('IS')) return 'COMMENT ON';
    const value = c.next();
    const note = value?.kind === 'string' ? value.value : undefined;
    const table = find(tableParts);
    if (!table) {
      missing(tableParts, line, 'a comment');
      return undefined;
    }
    const target = onTable ? table : columnOf(table, parts[parts.length - 1]!);
    if (!target) ctx.warn(`Skipped a comment: table "${table.name}" has no column "${parts[parts.length - 1]}"`, line);
    else if (note === undefined) delete target.note;
    else target.note = note;
    return undefined;
  }

  /** SQL Server's `EXEC sp_addextendedproperty 'MS_Description', …`: a table or column description. */
  function extendedProperty(c: Cursor, line: number): string | undefined {
    const proc = c.qualifiedName();
    if (!proc || proc[proc.length - 1]!.toLowerCase() !== 'sp_addextendedproperty') return 'EXEC';
    const order = ['@name', '@value', '@level0type', '@level0name', '@level1type', '@level1name', '@level2type', '@level2name'];
    const args = new Map<string, string>();
    splitTop(c.rest()).forEach((item, k) => {
      const named = item[0]?.value.startsWith('@') && item[1]?.value === '=';
      const value = item[named ? 2 : 0];
      if (value?.kind === 'string') args.set(named ? item[0]!.value.toLowerCase() : (order[k] ?? ''), value.value);
    });
    if (args.get('@name') !== 'MS_Description' || args.get('@level1type')?.toUpperCase() !== 'TABLE') return 'EXEC';
    const tableParts = [args.get('@level0name') ?? 'dbo', args.get('@level1name') ?? ''];
    const table = find(tableParts);
    if (!table) {
      missing(tableParts, line, 'a description');
      return undefined;
    }
    const colName = args.get('@level2type')?.toUpperCase() === 'COLUMN' ? args.get('@level2name') : undefined;
    const target = colName === undefined ? table : columnOf(table, colName);
    if (target) target.note = args.get('@value') ?? '';
    return undefined;
  }

  for (const st of splitStatements(sql, dialect)) {
    const c = Cursor.of(st);
    let kind: string | undefined = statementKind(st);
    if (c.eat('CREATE')) {
      c.eat('OR', 'REPLACE');
      c.eat('OR', 'ALTER');
      if (!c.eat('GLOBAL')) c.eat('LOCAL');
      while (c.eat('TEMP') || c.eat('TEMPORARY') || c.eat('UNLOGGED'));
      if (c.eat('TABLE')) kind = createTable(c, st.line);
      else if (c.isWord('INDEX') || c.isWord('UNIQUE') || c.isWord('CLUSTERED') || c.isWord('NONCLUSTERED') || c.isWord('FULLTEXT') || c.isWord('SPATIAL')) kind = createIndex(c, st.line, kind);
      else if (c.eat('TYPE')) kind = createType(c);
      else if (c.eat('SCHEMA')) kind = undefined;
    } else if (c.eat('ALTER', 'TABLE')) kind = alterTable(c, st.line);
    else if (c.eat('COMMENT', 'ON')) kind = commentOn(c, st.line);
    else if (c.eat('EXEC') || c.eat('EXECUTE')) kind = extendedProperty(c, st.line);
    if (kind !== undefined) skipped.set(kind, (skipped.get(kind) ?? 0) + 1);
  }

  schema.refs = resolveRefs(refs, find, ctx);
  return {
    schema,
    dialect,
    skipped: [...skipped].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    warnings: warnings.sort((a, b) => a.line - b.line),
  };
}

/** Whether these columns of the table are unique together: a primary or unique key on exactly them. */
function isUnique(table: Table, columns: string[]): boolean {
  if (columns.length === 1) {
    const col = columnOf(table, columns[0]!);
    if (col && (col.pk || col.unique)) return true;
  }
  const set = new Set(columns);
  return table.indexes.some((ix) => (ix.pk || ix.unique) && ix.parts.length === set.size && ix.parts.every((p) => p.kind === 'column' && set.has(p.value)));
}

/** The primary key columns of a table, for a foreign key that names only the table. */
function primaryKey(table: Table): string[] {
  const flagged = table.columns.filter((c) => c.pk).map((c) => c.name);
  if (flagged.length) return flagged;
  const ix = table.indexes.find((i) => i.pk && i.parts.every((p) => p.kind === 'column'));
  return ix ? ix.parts.map((p) => p.value) : [];
}

/** The foreign keys as refs, once every table is read: many-to-one, or one-to-one when the referencing columns are unique. */
function resolveRefs(pending: PendingRef[], find: (parts: string[]) => Table | undefined, ctx: TableContext): Ref[] {
  const refs: Ref[] = [];
  const seen = new Set<string>();
  for (const r of pending) {
    const from = find([r.from.schema, r.from.table]);
    const to = find([r.to.schema, r.to.table]);
    const label = `from table "${r.from.table}" to "${r.to.table}"`;
    if (!from || !to) {
      ctx.warn(`Left out a foreign key ${label}: there is no table "${!from ? r.from.table : r.to.table}"`, r.line);
      continue;
    }
    const fromCols = r.from.columns.map((n) => columnOf(from, n)?.name);
    const toCols = (r.to.columns.length ? r.to.columns : primaryKey(to)).map((n) => columnOf(to, n)?.name);
    if (!toCols.length || fromCols.length !== toCols.length || fromCols.includes(undefined) || toCols.includes(undefined)) {
      ctx.warn(`Left out a foreign key ${label}: its columns don't match`, r.line);
      continue;
    }
    const ref: Ref = {
      from: { schema: from.schema, table: from.name, columns: fromCols as string[] },
      to: { schema: to.schema, table: to.name, columns: toCols as string[] },
      op: isUnique(from, fromCols as string[]) ? '-' : '>',
      fromOptional: false,
      toOptional: false,
      inactive: false,
      inline: false,
    };
    const key = JSON.stringify([ref.from, ref.to]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.name !== undefined) ref.name = r.name;
    if (r.delete) ref.delete = r.delete;
    if (r.update) ref.update = r.update;
    refs.push(ref);
  }
  return refs;
}

/** Skipped statements as a sentence: "12 statements skipped: 8 INSERT, 4 CREATE VIEW"; empty when none were. */
export function skippedText(skipped: SkippedStatements[]): string {
  const total = skipped.reduce((n, s) => n + s.count, 0);
  if (!total) return '';
  return `${total} statement${total === 1 ? '' : 's'} skipped: ${skipped.map((s) => `${s.count} ${s.kind}`).join(', ')}`;
}
