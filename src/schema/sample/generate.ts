// Sample rows for schema tables, made up from each column's type, name, checks, keys and refs, so they load into the
// tables the DuckDB build creates without breaking a constraint. Pure and seeded: the same schema, tables and seed
// always give the same rows. Parents come before the tables that refer to them, and a parent that has no rows is
// generated too. Columns whose default is an expression (`now()`) are left out, so the database fills them in.
import { duckdbType, foreignKey, primaryKey, uniqueKeys } from '../../compiler/ddl/duckdb';
import { typeKind, type TypeKind } from '../../compiler/ddl/types';
import { tableId } from '../diagram/geometry';
import { DEFAULT_SCHEMA, enumOf, qualified, type Column, type DbmlEnum, type DbmlSchema, type RecordValue, type Table } from '../model';
import { dbmlName } from '../write';
import { mergeBounds, readCheck, type Bound } from './checks';
import { mixSeed, seededRandom, type Random } from './random';
import { ADJECTIVES, CITIES, COUNTRIES, EMAIL_DOMAINS, FIRST_NAMES, LAST_NAMES, NOUNS, PHRASES, STATUSES, STREET_TYPES, STREET_WORDS, VERBS } from './words';

/** One table's generated rows: the columns they fill, in the table's order, and a value for each. */
export interface GeneratedTable {
  schema: string;
  table: string;
  columns: string[];
  rows: RecordValue[][];
}

/** Generated rows for several tables, in the order they must be inserted (parents first). */
export interface GeneratedRows {
  tables: GeneratedTable[];
  /** Diagram ids (`table:schema.name`) of parents generated because a chosen table refers to them and they had no rows. */
  added: string[];
  /** Sentences on what couldn't be followed: a check that isn't simple, a key that ran out of values. */
  notes: string[];
}

export interface SampleOptions {
  /** Rows per table. */
  rows: number;
  seed: number;
}

/** How often a column that may be null is. */
const NULL_SHARE = 0.1;
/** Tries at a row before it is given up on, and rows given up on in a row before the table is. */
const ATTEMPTS = 30;
const GIVE_UP = 20;
/** Tries before a unique value is made different on purpose (a number added to it). */
const PLAIN_TRIES = 3;

/** A table refers to `parent` through `columns`. */
interface Fk {
  columns: string[];
  parent: Table;
  parentColumns: string[];
  /** One-to-one, or the columns are unique: each parent row is used once. */
  distinct: boolean;
  self: boolean;
}

/** Thrown when a column can't take another value: the table stops there. */
class OutOfValues extends Error {}

type Kind = TypeKind | { kind: 'array' } | { kind: 'unknown' };

/** A column's kind: the common types via typeKind, the rest from the DuckDB type it is built as. */
function kindOf(type: string): Kind {
  if (/\[\d*\]\s*$/.test(type)) return { kind: 'array' };
  const known = typeKind(type);
  if (known) return known;
  const sql = duckdbType(type).sql;
  if (/^U?TINYINT$/.test(sql)) return { kind: 'int', bytes: 1 };
  if (/^U?SMALLINT$/.test(sql)) return { kind: 'int', bytes: 2 };
  if (/^U?INTEGER$/.test(sql)) return { kind: 'int', bytes: 4 };
  if (/^(U?BIGINT|HUGEINT)$/.test(sql)) return { kind: 'int', bytes: 8 };
  const dec = /^DECIMAL\((\d+),(\d+)\)$/.exec(sql);
  if (dec) return { kind: 'decimal', precision: Number(dec[1]), scale: Number(dec[2]) };
  if (sql === 'TIMETZ') return { kind: 'time' };
  return { kind: 'unknown' };
}

/** A column name as lower-case words: `createdAt` and `created_at` are both `created at`. */
const wordsOf = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number, width: number) => String(n).padStart(width, '0');
const digits = (r: Random, n: number) => Array.from({ length: n }, () => r.int(0, 9)).join('');
const letters = (r: Random, n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + r.int(0, 25))).join('');
const alnum = (r: Random, n: number) => Array.from({ length: n }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[r.int(0, 35)]).join('');

/** Dates fall in 2023 to 2025, fixed rather than relative to today so a seed gives the same rows on any day. */
const EPOCH = Date.UTC(2023, 0, 1);
const DAYS = 3 * 365;
const isoDate = (r: Random) => new Date(EPOCH + r.int(0, DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
const isoTime = (r: Random) => `${pad(r.int(0, 23), 2)}:${pad(r.int(0, 59), 2)}:${pad(r.int(0, 59), 2)}`;
const isoTimestamp = (r: Random) => new Date(EPOCH + r.int(0, DAYS * 86_400 - 1) * 1000).toISOString().slice(0, 19).replace('T', ' ');

function uuid(r: Random): string {
  const hex = (n: number) => Array.from({ length: n }, () => r.int(0, 15).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[r.int(0, 3)]}${hex(3)}-${hex(12)}`;
}

const PRODUCTISH = /product|item|article|goods|sku|catalog|categor|tag|brand|service|plan|course|book|game|project|team|store|shop|menu|dish|recipe|part/;

/** Text for a column, steered by its name; undefined when the name says nothing. */
function namedText(words: string[], table: string, length: number | undefined, r: Random): string | undefined {
  const has = (...w: string[]) => w.some((x) => words.includes(x));
  const compact = words.join('');
  const last = words[words.length - 1];
  const first = () => r.pick(FIRST_NAMES);
  const surname = () => r.pick(LAST_NAMES);
  if (has('email', 'mail') || compact === 'emailaddress') return `${first().toLowerCase()}.${surname().toLowerCase()}@${r.pick(EMAIL_DOMAINS)}`;
  if (['firstname', 'givenname', 'forename'].includes(compact)) return first();
  if (['lastname', 'surname', 'familyname'].includes(compact)) return surname();
  if (has('username', 'login', 'handle') || compact === 'username') return `${first().toLowerCase()}${r.int(1, 99)}`;
  if (has('city', 'town')) return r.pick(CITIES);
  if (has('country')) {
    const c = r.pick(COUNTRIES);
    if (length === 2 || has('code', 'iso')) return c.code2;
    return length === 3 ? c.code3 : c.name;
  }
  if (has('phone', 'mobile', 'tel', 'telephone', 'fax', 'cell')) return `+44 7700 900${digits(r, 3)}`;
  if (has('url', 'website', 'homepage', 'link', 'site')) return `https://www.${r.pick(EMAIL_DOMAINS)}/${r.pick(NOUNS)}`;
  if (has('description', 'notes', 'note', 'bio', 'summary', 'comment', 'comments', 'body', 'content', 'details', 'about', 'message', 'text'))
    return `${cap(r.pick(ADJECTIVES))} ${r.pick(NOUNS)} that ${r.pick(VERBS)} ${r.pick(PHRASES)}.`;
  if (has('title', 'subject', 'headline', 'heading')) return `${cap(r.pick(ADJECTIVES))} ${r.pick(NOUNS)} ${r.pick(['guide', 'notes', 'review', 'story', 'plan'])}`;
  if (has('sku')) return `SKU-${digits(r, 5)}`;
  if (has('zip', 'zipcode', 'postcode', 'postal')) return digits(r, 5);
  if (has('address', 'street', 'addr')) return `${r.int(1, 250)} ${r.pick(STREET_WORDS)} ${r.pick(STREET_TYPES)}`;
  if (has('code')) return `${letters(r, 3)}${digits(r, 3)}`;
  if (has('status')) return r.pick(STATUSES);
  if (has('company', 'business', 'organisation', 'organization', 'employer')) return `${r.pick(STREET_WORDS)} ${r.pick(['Ltd', 'Group', 'Studio', 'Partners', 'Works'])}`;
  if (last === 'at' || last === 'on' || has('date', 'timestamp', 'datetime') || ['created', 'updated', 'deleted', 'modified'].includes(compact)) return isoTimestamp(r);
  if (has('name') || compact === 'fullname') {
    if (PRODUCTISH.test(table.toLowerCase()) || words.some((w) => PRODUCTISH.test(w))) return `${cap(r.pick(ADJECTIVES))} ${r.pick(NOUNS)}`;
    return `${first()} ${surname()}`;
  }
  return undefined;
}

/** A default range for a number column, steered by its name. */
function numberRange(words: string[], kind: 'int' | 'decimal' | 'float'): [number, number] {
  const has = (...w: string[]) => w.some((x) => words.includes(x));
  if (has('quantity', 'qty', 'count', 'units')) return [1, 10];
  if (has('price', 'amount', 'total', 'cost', 'balance', 'salary', 'fee', 'subtotal', 'revenue', 'value')) return [1, 500];
  if (has('age')) return [18, 90];
  if (has('year')) return [1990, 2025];
  if (has('rating', 'score', 'stars')) return [1, 5];
  if (has('percent', 'pct', 'percentage')) return [0, 100];
  return kind === 'int' ? [1, 1000] : [0, 1000];
}

/** The tuple of key values as text, or undefined when one is null (SQL keeps rows with a null key apart). */
function keyText(values: (RecordValue | undefined)[]): string | undefined {
  const parts: string[] = [];
  for (const v of values) {
    if (!v || v.kind === 'null' || v.kind === 'empty' || v.kind === 'expression') return undefined;
    parts.push(v.kind === 'number' ? String(Number(v.value)) : v.kind === 'enum' ? v.value.split('.').pop()! : v.value);
  }
  return parts.join('\u0000');
}

/** An enum value: `order_status.paid` when every part is a plain name, else the value as a string (DuckDB casts both). */
function enumValue(e: DbmlEnum, value: string): RecordValue {
  const parts = [...(e.schema === DEFAULT_SCHEMA ? [] : [e.schema]), e.name, value];
  return parts.every((p) => dbmlName(p) === p) ? { kind: 'enum', value: parts.join('.') } : { kind: 'string', value };
}

const NULL: RecordValue = { kind: 'null', value: 'null' };
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Sample rows for the tables (diagram ids, `table:schema.name`), and for any parent of theirs that has no rows. */
export function generateRows(schema: DbmlSchema, tables: string[], options: SampleOptions): GeneratedRows {
  const notes: string[] = [];
  const note = (text: string) => {
    if (!notes.includes(text)) notes.push(text);
  };
  const name = (t: Table) => qualified(t.schema, t.name);
  const find = (s: string, n: string) => schema.tables.find((t) => t.schema === s && t.name === n);
  const target = Math.max(0, Math.floor(options.rows));

  const chosen: Table[] = [];
  for (const id of tables) {
    const t = schema.tables.find((x) => tableId(x) === id);
    if (!t) note(`There is no table ${id.replace(/^table:/, '')} in the schema.`);
    else if (!chosen.includes(t)) chosen.push(t);
  }

  // Each table's foreign keys, as the DuckDB build reads refs.
  const fksOf = new Map<Table, Fk[]>();
  for (const ref of schema.refs) {
    const fk = foreignKey(ref);
    if (!fk) continue;
    const child = find(fk.child.schema, fk.child.table);
    const parent = find(fk.parent.schema, fk.parent.table);
    if (!child || !parent || fk.child.columns.length !== fk.parent.columns.length) continue;
    if (!fk.child.columns.every((c) => child.columns.some((x) => x.name === c)) || !fk.parent.columns.every((c) => parent.columns.some((x) => x.name === c))) continue;
    const list = fksOf.get(child) ?? [];
    if (list.some((x) => x.parent === parent && sameSet(x.columns, fk.child.columns))) continue;
    const distinct = ref.op === '-' || uniqueKeys(child).some((k) => sameSet(k, fk.child.columns));
    list.push({ columns: fk.child.columns, parent, parentColumns: fk.parent.columns, distinct, self: child === parent });
    fksOf.set(child, list);
  }

  /** The rows a table already has (not examples): the given columns of each, where none is missing or null. */
  const existingTuples = (t: Table, columns: string[]): RecordValue[][] => {
    const out: RecordValue[][] = [];
    for (const r of schema.records) {
      if (r.schema !== t.schema || r.table !== t.name || r.example) continue;
      const at = columns.map((c) => r.columns.indexOf(c));
      if (at.some((i) => i < 0)) continue;
      for (const row of r.rows) {
        const tuple = at.map((i) => row[i]!);
        if (keyText(tuple) !== undefined) out.push(tuple);
      }
    }
    return out;
  };
  const existingCount = (t: Table) => schema.records.filter((r) => r.schema === t.schema && r.table === t.name && !r.example).reduce((n, r) => n + r.rows.length, 0);

  // Parents with no rows are pulled in, and their parents in turn.
  const set = [...chosen];
  const added: string[] = [];
  for (let i = 0; i < set.length; i++)
    for (const fk of fksOf.get(set[i]!) ?? [])
      if (!fk.self && !set.includes(fk.parent) && existingCount(fk.parent) === 0) {
        set.push(fk.parent);
        added.push(tableId(fk.parent));
      }

  // Parents first, in schema order otherwise; a ref that closes a loop is noted and its columns left empty.
  const order: Table[] = [];
  const state = new Map<Table, 'visiting' | 'done'>();
  const looped = new Set<Fk>();
  const visit = (t: Table) => {
    if (state.get(t)) return;
    state.set(t, 'visiting');
    for (const fk of fksOf.get(t) ?? []) {
      if (fk.self || !set.includes(fk.parent)) continue;
      if (state.get(fk.parent) === 'visiting') looped.add(fk);
      else visit(fk.parent);
    }
    state.set(t, 'done');
    order.push(t);
  };
  schema.tables.filter((t) => set.includes(t)).forEach(visit);

  const generated = new Map<Table, GeneratedTable>();
  /** The rows a ref can point at: the parent's own rows and the ones generated for it. */
  const parentTuples = (fk: Fk): RecordValue[][] => {
    const tuples = existingTuples(fk.parent, fk.parentColumns);
    const gen = generated.get(fk.parent);
    if (gen) {
      const at = fk.parentColumns.map((c) => gen.columns.indexOf(c));
      if (at.every((i) => i >= 0)) for (const row of gen.rows) if (keyText(at.map((i) => row[i])) !== undefined) tuples.push(at.map((i) => row[i]!));
    }
    return tuples;
  };

  // Every column some ref points at, so it is generated even when it has an expression default.
  const referenced = new Set<string>();
  for (const [, list] of fksOf) for (const fk of list) for (const c of fk.parentColumns) referenced.add(`${tableId(fk.parent)}.${c}`);

  for (const t of order) {
    const r = seededRandom(mixSeed(options.seed, tableId(t)));
    const pk = primaryKey(t);
    const keys = uniqueKeys(t);
    const inKey = new Set(keys.flat());
    const fks = fksOf.get(t) ?? [];
    const fkOf = new Map<string, Fk>();
    for (const fk of fks) for (const c of fk.columns) if (!fkOf.has(c)) fkOf.set(c, fk);

    // Checks on the table and its columns, by column; the ones that aren't simple are noted.
    const bounds = new Map<string, Bound>();
    const checks = [...t.columns.flatMap((c) => c.checks.map((x) => ({ expression: x, column: c.name as string | undefined }))), ...t.checks.map((c) => ({ expression: c.expression, column: undefined }))];
    for (const check of checks) {
      const parts = readCheck(check.expression);
      if (!parts || parts.some((p) => !t.columns.some((c) => c.name === p.column))) {
        note(`The check \`${check.expression}\` on ${name(t)} isn’t one sample rows can follow, so some rows may break it.`);
        continue;
      }
      for (const p of parts) bounds.set(p.column, mergeBounds(bounds.get(p.column) ?? {}, p.bound));
    }

    const keep = (c: Column) => c.default?.kind !== 'expression' || c.increment || inKey.has(c.name) || fkOf.has(c.name) || referenced.has(`${tableId(t)}.${c.name}`);
    const columns = t.columns.filter(keep);
    const nullable = (c: Column) => c.notNull !== true && !pk.includes(c.name) && !inKey.has(c.name) && !bounds.get(c.name)?.notNull;
    const rows: RecordValue[][] = [];

    // Context a value is made in: the row so far, which row it is and which try at it.
    interface Ctx {
      index: number;
      attempt: number;
      row: Map<string, RecordValue>;
    }

    /** How one column's values are made (foreign key columns aside). */
    const columnGen = (c: Column): ((ctx: Ctx) => RecordValue) => {
      const bound = bounds.get(c.name) ?? {};
      const words = wordsOf(c.name);
      const where = `${name(t)}.${c.name}`;
      const e = enumOf(schema, c);
      const kind = kindOf(c.type);
      const numeric = kind.kind === 'int' || kind.kind === 'decimal' || kind.kind === 'float' || kind.kind === 'double';
      if (!numeric && !e && (bound.min !== undefined || bound.max !== undefined)) note(`The check on ${where} compares it with a number, which sample rows can’t follow for a ${c.type} column.`);
      const unique = inKey.has(c.name);

      if (e && e.values.length) {
        let values = e.values.map((v) => v.name);
        if (bound.values) {
          const allowed = values.filter((v) => bound.values!.some((b) => b.value === v));
          if (allowed.length) values = allowed;
          else note(`The check on ${where} allows none of the values of ${qualified(e.schema, e.name)}.`);
        }
        return () => enumValue(e, r.pick(values));
      }
      if (bound.values?.length) {
        const values = bound.values;
        return () => {
          const v = r.pick(values);
          return numeric ? { kind: 'number', value: v.value } : kind.kind === 'boolean' ? { kind: 'boolean', value: v.value } : { kind: 'string', value: v.value };
        };
      }

      if (numeric) {
        const scale = kind.kind === 'decimal' ? (kind.scale ?? (kind.precision ? 0 : 2)) : kind.kind === 'int' ? 0 : 2;
        const f = 10 ** scale;
        const cap15 = (n: number) => Math.min(n, 1e15);
        const typeMax =
          kind.kind === 'int' ? { 1: 127, 2: 32_767, 4: 2_147_483_647, 8: 1e15 }[kind.bytes] : kind.kind === 'decimal' ? cap15(10 ** (kind.precision ?? 18) - 1) / f : 1e9;
        // Everything in units of the smallest step (cents for decimal(10,2)), so sums stay exact.
        const lowest = Math.round(-typeMax * f);
        const highest = Math.round(typeMax * f);
        const minU = bound.min === undefined ? lowest : Math.max(lowest, bound.minExclusive ? Math.floor(bound.min * f + 1e-9) + 1 : Math.ceil(bound.min * f - 1e-9));
        const maxU = bound.max === undefined ? highest : Math.min(highest, bound.maxExclusive ? Math.ceil(bound.max * f - 1e-9) - 1 : Math.floor(bound.max * f + 1e-9));
        let [lo, hi] = numberRange(words, kind.kind === 'int' ? 'int' : 'decimal').map((n) => Math.round(n * f)) as [number, number];
        if (minU > maxU) note(`The checks on ${where} leave no values to choose from.`);
        else if (Math.max(lo, minU) <= Math.min(hi, maxU)) [lo, hi] = [Math.max(lo, minU), Math.min(hi, maxU)];
        else if (lo > maxU) [lo, hi] = [Math.max(minU, maxU - (hi - lo)), maxU];
        else [lo, hi] = [minU, Math.min(maxU, minU + (hi - lo))];
        const show = (units: number) => (scale ? (units / f).toFixed(scale) : String(units));

        if (kind.kind === 'int' && (c.increment || c.pk)) {
          const used = existingTuples(t, [c.name]).map(([v]) => Number(v!.value)).filter(Number.isFinite);
          const start = Math.max(minU, Math.max(0, ...used, c.increment ? existingCount(t) : 0) + 1);
          return () => {
            const n = start + rows.length;
            if (n > maxU) throw new OutOfValues(`${c.name} can’t go above ${show(maxU)}`);
            return { kind: 'number', value: String(n) };
          };
        }
        return (ctx) => {
          // A unique number that keeps clashing is drawn from everything the column allows.
          const wide = unique && ctx.attempt >= PLAIN_TRIES;
          return { kind: 'number', value: show(wide ? r.int(Math.max(minU, -1e9 * f), Math.min(maxU, 1e9 * f)) : r.int(lo, hi)) };
        };
      }

      switch (kind.kind) {
        case 'boolean':
          return () => ({ kind: 'boolean', value: r.chance(0.5) ? 'true' : 'false' });
        case 'date':
          return () => ({ kind: 'string', value: isoDate(r) });
        case 'time':
          return () => ({ kind: 'string', value: isoTime(r) });
        case 'timestamp':
          return () => ({ kind: 'string', value: isoTimestamp(r) });
        case 'timestamptz':
          return () => ({ kind: 'string', value: `${isoTimestamp(r)}+00` });
        case 'uuid':
          return () => ({ kind: 'string', value: uuid(r) });
        case 'json':
          return () => ({ kind: 'string', value: `{"id": ${r.int(1, 1000)}, "tag": "${r.pick(ADJECTIVES)}"}` });
        case 'interval':
          return () => ({ kind: 'string', value: `${r.int(1, 30)} days` });
        case 'array':
          return () => ({ kind: 'string', value: '[]' });
      }

      // Text: steered by the name, cut to the column's length, and made different on purpose when it must be unique.
      const length = kind.kind === 'varchar' ? kind.length : kind.kind === 'char' ? (kind.length ?? 1) : undefined;
      const fixed = kind.kind === 'char';
      return (ctx) => {
        let text = namedText(words, t.name, length, r) ?? (fixed ? letters(r, length ?? 1) : `${r.pick(ADJECTIVES)} ${r.pick(NOUNS)}`);
        if (unique && ctx.attempt >= PLAIN_TRIES) {
          const suffix = String(ctx.index + 1) + (ctx.attempt > PLAIN_TRIES ? digits(r, 3) : '');
          if (length !== undefined && suffix.length >= length) text = alnum(r, length);
          else if (text.includes('@')) text = text.replace('@', `${suffix}@`);
          else text = `${text.slice(0, length === undefined ? undefined : length - suffix.length)}${suffix}`;
        }
        if (length !== undefined && text.length > length) text = text.slice(0, length);
        return { kind: 'string', value: text };
      };
    };

    const gens = new Map(columns.filter((c) => !fkOf.has(c.name)).map((c) => [c.name, columnGen(c)]));

    // Each foreign key's rows to point at; one-to-one keys take each once (taken on the row's acceptance).
    const fkState = fks.map((fk) => {
      const own = fk.columns.filter((c) => fkOf.get(c) === fk);
      const required = fk.columns.some((c) => !nullable(t.columns.find((x) => x.name === c)!));
      const loop = looped.has(fk) ? existingTuples(fk.parent, fk.parentColumns) : undefined;
      if (loop && !loop.length) note(`The ref from ${name(t)} to ${name(fk.parent)} is left empty: the tables refer to each other in a loop.`);
      const pool = loop ?? (fk.self ? existingTuples(t, fk.parentColumns) : parentTuples(fk));
      // For a one-to-one key, the parent rows no child row points at yet.
      const taken = new Set(fk.distinct ? existingTuples(t, fk.columns).map((x) => keyText(x)!) : []);
      return { fk, own, required, size: pool.length, free: fk.distinct ? pool.filter((x) => !taken.has(keyText(x)!)) : pool };
    });
    type Pick = { s: (typeof fkState)[number]; at: number };

    const keySets = keys.map((k) => new Set(existingTuples(t, k).map((x) => keyText(x)!)));
    let failedInRow = 0;
    let reason: string | undefined;
    const clashes = new Map<string, number>();

    for (let tries = 0; rows.length < target && tries < target + 1000 && !reason; tries++) {
      let made: { row: Map<string, RecordValue>; picks: Pick[] } | undefined;
      try {
        for (let attempt = 0; attempt < ATTEMPTS && !made; attempt++) {
          const ctx: Ctx = { index: rows.length, attempt, row: new Map() };
          for (const c of columns) {
            const gen = gens.get(c.name);
            if (gen) ctx.row.set(c.name, nullable(c) && r.chance(NULL_SHARE) ? NULL : gen(ctx));
          }
          const picks: Pick[] = [];
          for (const s of fkState) {
            const { fk } = s;
            let tuple: RecordValue[] | undefined;
            const empty = !s.free.length;
            if (!s.required && (empty || r.chance(NULL_SHARE))) tuple = undefined;
            else if (!empty) {
              const at = r.int(0, s.free.length - 1);
              tuple = s.free[at]!;
              if (fk.distinct) picks.push({ s, at });
            } else if (fk.self && fk.parentColumns.every((c) => ctx.row.get(c) && ctx.row.get(c)!.kind !== 'null')) tuple = fk.parentColumns.map((c) => ctx.row.get(c)!);
            else if (looped.has(fk)) tuple = undefined;
            else if (fk.distinct && s.size) throw new OutOfValues(`each row needs a row of ${name(fk.parent)} of its own and there are only ${s.size}`);
            else throw new OutOfValues(`${name(fk.parent)} has no rows for ${fk.columns.join(', ')} to point at`);
            fk.columns.forEach((c, i) => {
              if (s.own.includes(c)) ctx.row.set(c, tuple ? tuple[i]! : NULL);
            });
          }
          const clash = keys.findIndex((k, i) => {
            const text = keyText(k.map((c) => ctx.row.get(c)));
            return text !== undefined && keySets[i]!.has(text);
          });
          if (clash < 0) made = { row: ctx.row, picks };
          else clashes.set(keys[clash]!.join(', '), (clashes.get(keys[clash]!.join(', ')) ?? 0) + 1);
        }
      } catch (err) {
        if (!(err instanceof OutOfValues)) throw err;
        reason = err.message;
        break;
      }
      if (!made) {
        if (++failedInRow >= GIVE_UP) {
          const worst = [...clashes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
          reason = `there aren’t enough different values for ${worst}`;
        }
        continue;
      }
      failedInRow = 0;
      const row = made.row;
      keys.forEach((k, i) => {
        const text = keyText(k.map((c) => row.get(c)));
        if (text !== undefined) keySets[i]!.add(text);
      });
      // A one-to-one parent row is used up: swapped with the last free one and dropped.
      for (const { s, at } of made.picks) {
        s.free[at] = s.free[s.free.length - 1]!;
        s.free.pop();
      }
      for (const s of fkState) {
        if (!s.fk.self) continue;
        const tuple = s.fk.parentColumns.map((c) => row.get(c));
        if (keyText(tuple) === undefined) continue;
        s.size++;
        s.free.push(tuple as RecordValue[]);
      }
      rows.push(columns.map((c) => row.get(c.name) ?? NULL));
    }
    if (rows.length < target) {
      const why = reason ?? 'there aren’t enough different values for its keys';
      note(rows.length ? `Only ${rows.length} of ${target} rows were generated for ${name(t)}: ${why}.` : `No rows were generated for ${name(t)}: ${why}.`);
    }
    generated.set(t, { schema: t.schema, table: t.name, columns: columns.map((c) => c.name), rows });
  }

  return { tables: order.map((t) => generated.get(t)!), added, notes };
}
