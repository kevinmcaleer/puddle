// DuckDB's statements that change a table, read into a SQL script as a new version of the table.
//
// A script never runs as statements (see sqlScript.ts): each table is a query. So INSERT, UPDATE, DELETE, ALTER TABLE
// and DROP TABLE are read here into the query that gives the table's rows after the change, written over the table's
// version before it, and CREATE TABLE name (columns) into a query for no rows with those columns. The script keeps
// what was written; only the compiled SQL holds these queries.
import type { SqlToken } from './customSql';
import { ident } from './sql';

/** What a statement does to the table it names. */
export type ChangeKind = 'declare' | 'insert' | 'update' | 'delete' | 'alter' | 'rename' | 'drop';

/** A span of the statement as written that is read as SQL (a query, a condition, a value), for marking its tables. */
export interface WrittenPiece {
  at: number;
  text: string;
  /** A value or condition rather than a query. */
  expr?: boolean;
}

/** A name the statement acts on: where it is, the name in lower case and as written, and whether it makes the table. */
export interface ChangedName {
  span: [start: number, end: number];
  table: string;
  label: string;
  makes: boolean;
}

/** A change statement read: the table's rows after it (empty for DROP), the names it acts on and the SQL it reads. */
export interface ReadChange {
  change: ChangeKind;
  /** The table the statement leaves: the one it changes, or the new name of ALTER TABLE ... RENAME TO. None for DROP. */
  table?: ChangedName;
  /** The table it changes, which must already be made: the same as `table` but for DROP and RENAME TO. */
  target?: ChangedName;
  /** DROP TABLE IF EXISTS: nothing to do when the table isn't there. */
  ifExists?: boolean;
  query: string;
  pieces: WrittenPiece[];
}

const end = (t: SqlToken) => t.start + t.text.length;
const isName = (t: SqlToken | undefined): t is SqlToken => !!t && (t.kind === 'word' || t.kind === 'quoted');
const labelOf = (t: SqlToken) => (t.kind === 'quoted' ? t.text.slice(1, -1).replace(/""/g, '"') : t.text);
const nameOf = (t: SqlToken, makes = false): ChangedName => ({ span: [t.start, end(t)], table: t.value, label: labelOf(t), makes });
/** The words a query may start with, as the rows to insert. */
const QUERY_START = new Set(['select', 'with', 'from', 'values', 'table']);

class Refused extends Error {}
const refuse = (why: string): never => {
  throw new Refused(why);
};

/**
 * Read a statement that changes a table (or CREATE TABLE name (columns)) into the query for the table's rows after it.
 * `words` are its tokens without comments and `sql` the script they come from. Undefined when the statement isn't one
 * of these, so it is read as before.
 */
export function readChange(words: SqlToken[], sql: string): ReadChange | { problem: string } | undefined {
  const first = words[0];
  if (first?.kind !== 'word') return undefined;
  try {
    const r = new Reader(words, sql);
    switch (first.value) {
      case 'insert':
        return r.insert();
      case 'update':
        return r.update();
      case 'delete':
        return r.delete();
      case 'alter':
        return r.alter();
      case 'drop':
        return r.drop();
      case 'create':
        return r.declare();
      default:
        return undefined;
    }
  } catch (e) {
    if (e instanceof Refused) return { problem: e.message };
    throw e;
  }
}

class Reader {
  private k = 1;
  constructor(
    private readonly words: SqlToken[],
    private readonly sql: string,
  ) {}

  private at(offset = 0): SqlToken | undefined {
    return this.words[this.k + offset];
  }

  private is(value: string, offset = 0): boolean {
    const t = this.at(offset);
    return t?.kind === 'word' && t.value === value;
  }

  /** Skip the word if it is next; true when it was. */
  private optional(...values: string[]): boolean {
    if (!values.every((v, i) => this.is(v, i))) return false;
    this.k += values.length;
    return true;
  }

  private expect(value: string, why: string): void {
    if (!this.optional(value)) refuse(why);
  }

  /** A table's name, with no schema or database before it. */
  private table(what: string): SqlToken {
    const t = this.at();
    if (!isName(t)) return refuse(`name the table ${what}`);
    if (this.at(1)?.text === '.') refuse(`name ${labelOf(this.words[this.k + 2] ?? t)} without a schema or database before it`);
    this.k++;
    return t;
  }

  private column(what: string): SqlToken {
    const t = this.at();
    if (!isName(t)) return refuse(`name the column ${what}`);
    if (this.at(1)?.text === '.') refuse(`name the column ${labelOf(t)} without its table before it`);
    this.k++;
    return t;
  }

  /** The text from token `from` to token `to` (inclusive) as written, and the piece it is. */
  private text(from: number, to: number): WrittenPiece {
    const a = this.words[from]!;
    const b = this.words[to]!;
    return { at: a.start, text: this.sql.slice(a.start, end(b)) };
  }

  /** The index of the next of these words at the top level (outside brackets) from the reader on, or the end. */
  private until(...values: string[]): number {
    let depth = 0;
    for (let i = this.k; i < this.words.length; i++) {
      const t = this.words[i]!;
      if (t.kind === 'op' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++;
      else if (t.kind === 'op' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
      else if (depth === 0 && t.kind === 'word' && values.includes(t.value)) return i;
    }
    return this.words.length;
  }

  /** The tokens from the reader up to `to` (exclusive), split at top-level commas. */
  private list(to: number): [from: number, to: number][] {
    const parts: [number, number][] = [];
    let depth = 0;
    let from = this.k;
    for (let i = this.k; i < to; i++) {
      const t = this.words[i]!;
      if (t.kind === 'op' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++;
      else if (t.kind === 'op' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
      else if (depth === 0 && t.kind === 'op' && t.text === ',') {
        parts.push([from, i - 1]);
        from = i + 1;
      }
    }
    if (from < to) parts.push([from, to - 1]);
    return parts;
  }

  /** The bracket opening at `from` and where it closes. */
  private closing(from: number): number {
    let depth = 0;
    for (let i = from; i < this.words.length; i++) {
      const t = this.words[i]!;
      if (t.kind !== 'op') continue;
      if (t.text === '(') depth++;
      else if (t.text === ')' && --depth === 0) return i;
    }
    return refuse('close the bracket with )');
  }

  private noneOf(stops: Record<string, string>, to = this.words.length): void {
    const found = this.until(...Object.keys(stops));
    if (found < to) refuse(stops[this.words[found]!.value]!);
  }

  // INSERT INTO name [BY NAME | BY POSITION] [(columns)] query | VALUES (...)
  insert(): ReadChange {
    if (this.is('or')) refuse(`INSERT OR ${(this.at(1)?.text ?? '').toUpperCase()} needs a key to match rows on, which a script’s tables don’t keep: write INSERT INTO name SELECT ...`);
    this.expect('into', 'write INSERT INTO name and the rows to add');
    const name = this.table('to insert into: INSERT INTO name SELECT ...');
    if (this.optional('as')) this.k++;
    let byName = false;
    if (this.optional('by', 'name')) byName = true;
    else this.optional('by', 'position');
    let columns: string | undefined;
    if (this.at()?.text === '(' && !(this.at(1)?.kind === 'word' && QUERY_START.has(this.at(1)!.value))) {
      const close = this.closing(this.k);
      this.k++;
      const cols = this.list(close).map(([a, b]) => {
        if (a !== b || !isName(this.words[a])) refuse('list the columns to insert into by name: INSERT INTO name (a, b) VALUES (...)');
        return ident(labelOf(this.words[a]!));
      });
      columns = cols.join(', ');
      this.k = close + 1;
    }
    if (this.is('default', 0) && this.is('values', 1)) refuse('give the rows to insert: INSERT INTO name VALUES (...) or SELECT ...');
    const start = this.at();
    if (!start || !((start.kind === 'word' && QUERY_START.has(start.value)) || start.text === '(')) refuse(`give the rows to insert into ${labelOf(name)}: INSERT INTO ${name.text} VALUES (...) or SELECT ...`);
    this.noneOf({ returning: 'a script keeps tables, so INSERT can’t return rows: query the table after it' });
    const conflict = this.words.findIndex((t, i) => i >= this.k && t.kind === 'word' && t.value === 'on' && this.words[i + 1]?.kind === 'word' && this.words[i + 1]!.value === 'conflict');
    if (conflict >= 0) refuse('a script’s tables keep no keys, so INSERT can’t ON CONFLICT: delete the rows first, then insert them');
    const rows = this.text(this.k, this.words.length - 1);
    const t = ident(labelOf(name));
    const union = byName || columns ? 'UNION ALL BY NAME' : 'UNION ALL';
    const query = `SELECT * FROM ${t}\n${union}\nSELECT * FROM (\n${rows.text}\n)${columns ? ` AS "__puddle_rows"(${columns})` : ''}`;
    return { change: 'insert', table: nameOf(name), target: nameOf(name), query, pieces: [rows] };
  }

  // UPDATE name SET column = value [, ...] [WHERE condition]
  update(): ReadChange {
    const name = this.table('to update: UPDATE name SET column = value');
    if (this.optional('as')) this.k++;
    else if (isName(this.at()) && !this.is('set')) this.k++;
    this.expect('set', `say what to change with SET: UPDATE ${name.text} SET column = value`);
    const stop = this.until('where', 'from', 'returning');
    const stopWord = this.words[stop]?.value;
    if (stopWord === 'from') refuse('UPDATE ... FROM reads another table: join it in a query instead, CREATE OR REPLACE TABLE name AS SELECT ...');
    const pieces: WrittenPiece[] = [];
    const sets = this.list(stop).map(([a, b]) => {
      const col = this.words[a];
      if (!isName(col) || this.words[a + 1]?.text !== '=' || a + 2 > b) refuse('write each change as column = value, such as SET status = \'closed\'');
      const value = this.text(a + 2, b);
      pieces.push({ ...value, expr: true });
      return { column: labelOf(col!), value: value.text };
    });
    if (!sets.length) refuse(`say what to change with SET: UPDATE ${name.text} SET column = value`);
    const seen = new Set<string>();
    for (const s of sets) {
      if (seen.has(s.column.toLowerCase())) refuse(`set ${s.column} once`);
      seen.add(s.column.toLowerCase());
    }
    this.k = stop;
    const where = this.where();
    if (where) pieces.push(where);
    const replaced = sets.map((s) => (where ? `CASE WHEN (${where.text}) IS TRUE THEN (${s.value}) ELSE ${ident(s.column)} END AS ${ident(s.column)}` : `(${s.value}) AS ${ident(s.column)}`));
    return { change: 'update', table: nameOf(name), target: nameOf(name), query: `SELECT * REPLACE (${replaced.join(', ')}) FROM ${ident(labelOf(name))}`, pieces };
  }

  /** WHERE condition to the end, or nothing; RETURNING refused. */
  private where(): WrittenPiece | undefined {
    if (this.k >= this.words.length) return undefined;
    if (this.is('returning')) refuse('a script keeps tables, so it can’t return rows: query the table after it');
    this.expect('where', `end the statement after its changes, or with WHERE and a condition (found ${this.at()?.text ?? ''})`);
    const stop = this.until('returning');
    if (stop < this.words.length) refuse('a script keeps tables, so it can’t return rows: query the table after it');
    if (this.k >= this.words.length) refuse('write the condition after WHERE');
    return { ...this.text(this.k, this.words.length - 1), expr: true };
  }

  // DELETE FROM name [WHERE condition]
  delete(): ReadChange {
    this.expect('from', 'write DELETE FROM name WHERE ...');
    const name = this.table('to delete from: DELETE FROM name WHERE ...');
    if (this.optional('as')) this.k++;
    else if (isName(this.at()) && !this.is('where') && !this.is('using') && !this.is('returning')) this.k++;
    if (this.is('using')) refuse('DELETE ... USING reads another table: write the condition with a subquery, WHERE id IN (SELECT id FROM other)');
    const where = this.where();
    const t = ident(labelOf(name));
    return { change: 'delete', table: nameOf(name), target: nameOf(name), query: where ? `SELECT * FROM ${t} WHERE (${where.text}) IS NOT TRUE` : `SELECT * FROM ${t} WHERE false`, pieces: where ? [where] : [] };
  }

  /** A column's type, from the reader to the first of these words at the top level (or the end). */
  private type(stops: string[]): WrittenPiece {
    const stop = this.until(...stops);
    if (stop <= this.k) refuse('give the column a type, such as VARCHAR or INTEGER');
    const piece = this.text(this.k, stop - 1);
    this.k = stop;
    return piece;
  }

  // ALTER TABLE name ADD | DROP | RENAME | ALTER ...
  alter(): ReadChange {
    if (!this.is('table')) refuse(`ALTER ${(this.at()?.text ?? '').toUpperCase()} isn’t something a script can do: it can ALTER TABLE`);
    this.k++;
    this.optional('if', 'exists');
    const name = this.table('to change: ALTER TABLE name ...');
    const t = ident(labelOf(name));
    const changed = (query: string, pieces: WrittenPiece[] = []): ReadChange => ({ change: 'alter', table: nameOf(name), target: nameOf(name), query, pieces });
    if (this.optional('rename', 'to')) {
      const to = this.table('to rename it to: ALTER TABLE name RENAME TO new_name');
      this.done();
      return { change: 'rename', table: nameOf(to, true), target: nameOf(name), query: `SELECT * FROM ${t}`, pieces: [] };
    }
    if (this.optional('rename')) {
      this.optional('column');
      const from = this.column('to rename: RENAME COLUMN old TO new');
      this.expect('to', `say the new name: RENAME COLUMN ${from.text} TO new_name`);
      const to = this.column('to rename it to');
      this.done();
      return changed(`SELECT * RENAME (${ident(labelOf(from))} AS ${ident(labelOf(to))}) FROM ${t}`);
    }
    if (this.optional('add')) {
      this.optional('column');
      if (this.optional('if', 'not', 'exists')) refuse('ADD COLUMN IF NOT EXISTS can’t tell from the script whether the column is there: add it with ADD COLUMN');
      if (this.is('constraint') || this.is('primary') || this.is('unique') || this.is('foreign') || this.is('check')) refuse('a script’s tables keep rows, not keys or constraints');
      const col = this.column('to add: ADD COLUMN name TYPE');
      const type = this.type(['default', 'not', 'null', 'primary', 'unique', 'check', 'references', 'collate', 'generated']);
      let value = 'NULL';
      const pieces: WrittenPiece[] = [];
      if (this.optional('default')) {
        const stop = this.until('not', 'null', 'primary', 'unique', 'check', 'references', 'collate');
        if (stop <= this.k) refuse('give the default a value after DEFAULT');
        const piece = this.text(this.k, stop - 1);
        pieces.push({ ...piece, expr: true });
        value = `(${piece.text})`;
        this.k = stop;
      }
      return changed(`SELECT *, CAST(${value} AS ${type.text}) AS ${ident(labelOf(col))} FROM ${t}`, pieces);
    }
    if (this.optional('drop')) {
      this.optional('column');
      if (this.is('constraint')) refuse('a script’s tables keep rows, not keys or constraints');
      this.optional('if', 'exists');
      const col = this.column('to drop: DROP COLUMN name');
      if (!this.optional('cascade')) this.optional('restrict');
      this.done();
      return changed(`SELECT * EXCLUDE (${ident(labelOf(col))}) FROM ${t}`);
    }
    if (this.optional('alter')) {
      this.optional('column');
      const col = this.column('to change: ALTER COLUMN name TYPE new_type');
      this.optional('set', 'data');
      if (!this.optional('type')) refuse(`a script’s tables keep rows, not defaults or constraints: change ${labelOf(col)}’s type with ALTER COLUMN ${col.text} TYPE new_type`);
      const type = this.type(['using', 'collate']);
      let value = ident(labelOf(col));
      const pieces: WrittenPiece[] = [];
      if (this.optional('using')) {
        if (this.k >= this.words.length) refuse('give the expression after USING');
        const piece = this.text(this.k, this.words.length - 1);
        pieces.push({ ...piece, expr: true });
        value = `(${piece.text})`;
        this.k = this.words.length;
      }
      return changed(`SELECT * REPLACE (CAST(${value} AS ${type.text}) AS ${ident(labelOf(col))}) FROM ${t}`, pieces);
    }
    return refuse(`say how to change ${labelOf(name)}: ADD COLUMN, DROP COLUMN, RENAME COLUMN, ALTER COLUMN ... TYPE or RENAME TO`);
  }

  private done(): void {
    if (this.k < this.words.length) refuse(`end the statement before ${this.at()!.text}`);
  }

  // DROP TABLE [IF EXISTS] name
  drop(): ReadChange {
    if (!this.is('table') && !this.is('view')) refuse(`DROP ${(this.at()?.text ?? '').toUpperCase()} isn’t something a script can do: it can DROP TABLE name`);
    this.k++;
    const ifExists = this.optional('if', 'exists');
    const name = this.table('to drop: DROP TABLE name');
    if (this.at()?.text === ',') refuse('drop one table at a time: DROP TABLE name');
    if (!this.optional('cascade')) this.optional('restrict');
    this.done();
    return { change: 'drop', target: nameOf(name), ifExists, query: '', pieces: [] };
  }

  // CREATE [OR REPLACE] [TEMP] TABLE [IF NOT EXISTS] name (column type, ...): no rows yet, those columns.
  declare(): ReadChange | undefined {
    this.optional('or', 'replace');
    if (!this.optional('temp')) this.optional('temporary');
    if (!this.optional('table')) return undefined;
    this.optional('if', 'not', 'exists');
    const name = this.at();
    if (!isName(name) || this.at(1)?.text !== '(') return undefined;
    this.k++;
    const close = this.closing(this.k);
    if (close !== this.words.length - 1) return undefined;
    this.k++;
    const pieces: WrittenPiece[] = [];
    const TABLE_CONSTRAINTS = new Set(['primary', 'unique', 'foreign', 'check', 'constraint']);
    const columns = this.list(close).flatMap(([a, b]) => {
      const col = this.words[a]!;
      if (col.kind === 'word' && TABLE_CONSTRAINTS.has(col.value)) return [];
      if (!isName(col) || a === b) refuse(`give each column a name and a type: CREATE TABLE ${name.text} (id INTEGER, name VARCHAR)`);
      // The type runs to the first constraint word; the constraints themselves aren't kept.
      let stop = a + 1;
      const CONSTRAINT = new Set(['not', 'null', 'primary', 'unique', 'default', 'check', 'references', 'collate', 'generated', 'as', 'constraint']);
      let depth = 0;
      for (; stop <= b; stop++) {
        const t = this.words[stop]!;
        if (t.text === '(') depth++;
        else if (t.text === ')') depth--;
        else if (depth === 0 && t.kind === 'word' && CONSTRAINT.has(t.value)) break;
      }
      if (stop === a + 1) refuse(`give ${labelOf(col)} a type, such as VARCHAR or INTEGER`);
      const type = this.text(a + 1, stop - 1);
      return [`CAST(NULL AS ${type.text}) AS ${ident(labelOf(col))}`];
    });
    if (!columns.length) refuse(`give ${labelOf(name)} its columns: CREATE TABLE ${name.text} (id INTEGER, name VARCHAR)`);
    return { change: 'declare', table: nameOf(name, true), query: `SELECT ${columns.join(', ')} WHERE false`, pieces };
  }
}
