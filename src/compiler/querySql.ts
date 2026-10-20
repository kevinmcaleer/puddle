// The query designer's SQL view, as in Microsoft Access: the design written out as SQL, and SQL read back into the
// design. Reading back understands the SQL the designer writes and the usual hand-written ways of saying the same
// things: joins in any order, unqualified names, criteria written as plain comparisons or ILIKE, a WHERE or HAVING
// with OR. Anything the grid can't show is refused with the reason, and the Query keeps the SQL and runs it as written.
import { criteriaCell, newId, type QueryCriteria, type QueryCriteriaOp, type QueryField, type QueryJoin, type QueryJoinKind, type QuerySpec, type QueryTotal } from '../model';
import { cleanCustomSql, customSqlProblem, INPUT_NAME, lexSql, SqlRefusal, type SqlToken } from './customSql';
import { defaultNames, joinPlan, queryClauses, queryProblems, tableAlias, type QueryTable } from './query';
import { ident } from './sql';
import { CUSTOM_SQL_OPENER } from './steps/advanced';

/** The names one table of a Query may be read by in its SQL: "input1", then its node's name when that's its own. */
export function querySqlNames(tables: Array<Pick<QueryTable, 'port' | 'label'>>): Map<number, string[]> {
  const lower = (s: string) => s.toLowerCase();
  const out = new Map<number, string[]>();
  for (const t of tables) {
    const names = [`input${t.port + 1}`];
    if (tables.length === 1) names.push(INPUT_NAME);
    const label = lower(t.label);
    const shared = tables.some((o) => o.port !== t.port && lower(o.label) === label);
    if (label && !shared && !/^input\d*$/.test(label)) names.push(t.label);
    out.set(t.port, names);
  }
  return out;
}

/** The name the SQL view writes for a table: its node's name, or input1 when that can't be used. */
const displayName = (names: string[]) => names[names.length - 1] === INPUT_NAME ? names[0]! : names[names.length - 1]!;

/** Why SQL kept on a Query can't run, in words that say what to change, or undefined. */
export function querySqlProblem(sql: string, tables: Array<Pick<QueryTable, 'port' | 'label'>>): string | undefined {
  return customSqlProblem(sql, [...querySqlNames(tables).values()].flat());
}

/** SQL kept on a Query as a SELECT over its tables' CTEs, each bound by the names it may be read by. */
export function compileQuerySql(sql: string, tables: Array<Pick<QueryTable, 'port' | 'label'> & { cte: string }>): string {
  const names = querySqlNames(tables);
  const ctes = tables.flatMap((t) => names.get(t.port)!.map((n) => `${ident(n)} AS (SELECT * FROM ${t.cte})`));
  return `WITH ${ctes.join(', ')}\n${CUSTOM_SQL_OPENER}\n${cleanCustomSql(sql)}\n)`;
}

/**
 * Words that stay quoted when the SQL view writes a name, because DuckDB reads them as keywords (its reserved and
 * column-name keywords), and the words this module's reader stops at.
 */
const KEYWORDS = new Set(
  (
    'all analyse analyze and anti any array as asc asof asymmetric authorization between binary both case cast check collate collation column ' +
    'concurrently constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp current_user ' +
    'default deferrable desc describe distinct do else end except exists false fetch filter for foreign freeze from full glob grant group having ' +
    'ilike in initially inner intersect into is isnull join lateral leading left like limit localtime localtimestamp natural not notnull null ' +
    'offset on only or order outer over overlaps pivot pivot_longer pivot_wider placing positional primary qualify references returning right ' +
    'select semi session_user show similar some summarize symmetric table then to trailing true union unique unpivot user using variadic ' +
    'verbose when where window with'
  ).split(' '),
);

/** A name as the SQL view writes it: bare when DuckDB reads it the same way, quoted otherwise. */
export const sqlName = (name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name.toLowerCase()) ? name : ident(name));

/** The SQL with every quoted name that doesn't need its quotes written bare. Strings and comments are left as they are. */
function unquote(sql: string): string {
  let out = sql;
  for (const t of lexSql(sql).reverse()) {
    if (t.kind !== 'quoted') continue;
    const name = t.text.slice(1, -1).replace(/""/g, '"');
    out = out.slice(0, t.start) + sqlName(name) + out.slice(t.start + t.text.length);
  }
  return out;
}

/**
 * The design as the SQL view shows it: one clause to a line, each join on a line of its own, and tables read and
 * qualified by their node's names, as Access writes them. Assumes queryProblems found nothing.
 */
export function designSql(spec: QuerySpec, tables: QueryTable[]): string {
  const names = querySqlNames(tables);
  const shown = new Map(tables.map((t) => [t.port, ident(displayName(names.get(t.port)!))]));
  const clauses = queryClauses(spec, tables.map((t) => ({ ...t, cte: shown.get(t.port)! })));
  // The design's SQL calls its tables t1, t2...; here each is read by its own name, which is never another's.
  const from = clauses[1]!.map((part) => tables.reduce((p, t) => p.replace(`${shown.get(t.port)} AS ${tableAlias(t.port)}`, () => shown.get(t.port)!), part));
  return unquote(byTableNames([clauses[0]!, from, ...clauses.slice(2)].map((c) => c.join('\n  ')).join('\n'), shown));
}

/** The SQL with each t1, t2... before a dot, as the design's SQL qualifies columns, called by its table's name instead. */
function byTableNames(sql: string, shown: Map<number, string>): string {
  let out = sql;
  const all = lexSql(sql);
  for (let i = all.length - 2; i >= 0; i--) {
    const t = all[i]!;
    const port = (t.kind === 'word' || t.kind === 'quoted') && all[i + 1]!.text === '.' ? /^t(\d+)$/.exec(t.value)?.[1] : undefined;
    const name = port == null ? undefined : shown.get(Number(port) - 1);
    if (name) out = out.slice(0, t.start) + name + out.slice(t.start + t.text.length);
  }
  return out;
}

/** What the SQL view makes of some SQL: the design it stands for, or why the grid can't show it. */
export type QuerySqlReading = { spec: QuerySpec } | { reason: string };

/** Thrown while reading SQL the grid can't show, with the reason in words that end a sentence. */
class Unmappable extends Error {}
const refuse = (reason: string): never => {
  throw new Unmappable(reason);
};

// ---- Expressions ------------------------------------------------------------------------------------------------

/** Where something is in the query's tokens: [first, end). */
type Range = [number, number];

type Expr =
  | { k: 'col'; table?: SqlToken; name: SqlToken; at: Range }
  | { k: 'star'; table?: SqlToken; at: Range }
  | { k: 'num'; text: string; at: Range }
  | { k: 'str'; value: string; at: Range }
  | { k: 'null'; at: Range }
  | { k: 'call'; name: string; distinct: boolean; star: boolean; args: Expr[]; at: Range }
  | { k: 'cast'; e: Expr; type: string; at: Range }
  | { k: 'bin'; op: string; l: Expr; r: Expr; at: Range }
  | { k: 'not'; e: Expr; at: Range }
  | { k: 'neg'; e: Expr; at: Range }
  | { k: 'isnull'; e: Expr; not: boolean; at: Range }
  | { k: 'like'; e: Expr; pattern: Expr; op: 'like' | 'ilike'; at: Range }
  | { k: 'paren'; e: Expr; at: Range };
type ColExpr = Extract<Expr, { k: 'col' }>;

const COMPARE_OPS = ['<=', '>=', '<>', '!=', '=', '<', '>'];
/** Words that start something the grid has no place for, wherever they come. */
const UNREADABLE = ['case', 'exists', 'interval', 'array', 'struct', 'lambda'];

/** The query's tokens, comments dropped, and the text they came from. */
interface Query {
  sql: string;
  tokens: SqlToken[];
}

/** The text of a range of tokens, as written. */
const textOf = (q: Query, [a, b]: Range) => (b > a ? q.sql.slice(q.tokens[a]!.start, q.tokens[b - 1]!.start + q.tokens[b - 1]!.text.length) : '');

/** A range of tokens in a form that ignores spacing and the case of names, for telling two expressions apart. */
const shapeOf = (tokens: SqlToken[]) => tokens.map((t) => (t.kind === 'word' || t.kind === 'quoted' ? `n:${t.value}` : t.text)).join(' ');

/** Reads expressions from a range of the query's tokens. Spans are the query's. */
class Reader {
  i: number;
  readonly end: number;
  constructor(
    readonly q: Query,
    range: Range,
  ) {
    [this.i, this.end] = range;
  }
  peek(o = 0): SqlToken | undefined {
    return this.i + o < this.end ? this.q.tokens[this.i + o] : undefined;
  }
  word(o = 0): string | undefined {
    const t = this.peek(o);
    return t?.kind === 'word' ? t.value : undefined;
  }
  isWord(...ws: string[]) {
    const w = this.word();
    return w != null && ws.includes(w);
  }
  take(): SqlToken {
    const t = this.peek();
    if (!t) return refuse('the query ends too soon');
    this.i++;
    return t;
  }
  takeWord(w: string) {
    if (!this.isWord(w)) refuse(`${w.toUpperCase()} is missing`);
    this.i++;
  }
  /** The operator next, joining the two-character ones the lexer gives as two tokens. */
  op(): string | undefined {
    const a = this.peek();
    if (a?.kind !== 'op') return undefined;
    const b = this.peek(1);
    const two = b?.kind === 'op' && b.start === a.start + 1 ? a.text + b.text : '';
    return ['<=', '>=', '<>', '!=', '||', '::'].includes(two) ? two : a.text;
  }
  takeOp(op: string) {
    this.i += op.length;
  }
  get done() {
    return this.i >= this.end;
  }

  expr(): Expr {
    return this.logical('or', () => this.logical('and', () => this.not()));
  }
  private logical(word: string, next: () => Expr): Expr {
    const start = this.i;
    let l = next();
    while (this.isWord(word)) {
      this.i++;
      l = { k: 'bin', op: word, l, r: next(), at: [start, this.i] };
    }
    return l;
  }
  private not(): Expr {
    const start = this.i;
    if (!this.isWord('not')) return this.compare();
    this.i++;
    return { k: 'not', e: this.not(), at: [start, this.i] };
  }
  private compare(): Expr {
    const start = this.i;
    const l = this.arithmetic(['+', '-', '||'], () => this.arithmetic(['*', '/', '%'], () => this.unary()));
    const op = this.op();
    const right = () => this.arithmetic(['+', '-', '||'], () => this.arithmetic(['*', '/', '%'], () => this.unary()));
    if (op && COMPARE_OPS.includes(op)) {
      this.takeOp(op);
      return { k: 'bin', op: op === '!=' ? '<>' : op, l, r: right(), at: [start, this.i] };
    }
    if (this.isWord('is')) {
      this.i++;
      const not = this.isWord('not');
      if (not) this.i++;
      this.takeWord('null');
      return { k: 'isnull', e: l, not, at: [start, this.i] };
    }
    if (this.isWord('like', 'ilike')) {
      const like = this.take().value as 'like' | 'ilike';
      return { k: 'like', e: l, pattern: right(), op: like, at: [start, this.i] };
    }
    if (this.isWord('not', 'in', 'between', 'similar', 'glob')) refuse(`${this.peek()!.text.toUpperCase()} has no place in the design grid`);
    return l;
  }
  private arithmetic(ops: string[], next: () => Expr): Expr {
    const start = this.i;
    let l = next();
    for (let op = this.op(); op && ops.includes(op); op = this.op()) {
      this.takeOp(op);
      l = { k: 'bin', op, l, r: next(), at: [start, this.i] };
    }
    return l;
  }
  private unary(): Expr {
    const start = this.i;
    if (this.op() === '-') {
      this.i++;
      return { k: 'neg', e: this.unary(), at: [start, this.i] };
    }
    let e = this.primary();
    while (this.op() === '::') {
      this.takeOp('::');
      e = { k: 'cast', e, type: this.typeName(), at: [start, this.i] };
    }
    return e;
  }
  /** A type, as written: VARCHAR, DOUBLE, DECIMAL(10, 2). */
  private typeName(): string {
    const t = this.take();
    if (t.kind !== 'word') refuse(`${t.text} isn’t a type`);
    let type = t.value;
    if (this.op() !== '(') return type;
    let depth = 0;
    do {
      const x = this.take();
      if (x.text === '(') depth++;
      if (x.text === ')') depth--;
      type += x.text;
    } while (depth > 0);
    return type;
  }
  private close(what: string) {
    if (this.op() !== ')') refuse(`${what} isn’t closed, or has more in it than the design grid reads`);
    this.i++;
  }
  private primary(): Expr {
    const start = this.i;
    const t = this.take();
    const at = (): Range => [start, this.i];
    if (t.kind === 'number') return { k: 'num', text: t.text, at: at() };
    if (t.kind === 'string') return { k: 'str', value: t.value, at: at() };
    if (t.kind === 'op' && t.text === '*') return { k: 'star', at: at() };
    if (t.kind === 'op' && t.text === '(') {
      if (this.isWord('select', 'with', 'from', 'values')) refuse('a subquery has no place in the design grid');
      const e = this.expr();
      this.close('a bracket');
      return { k: 'paren', e, at: at() };
    }
    if (t.kind === 'word' && t.value === 'null') return { k: 'null', at: at() };
    if (t.kind === 'word' && t.value === 'cast' && this.op() === '(') {
      this.i++;
      const e = this.expr();
      this.takeWord('as');
      const type = this.typeName();
      this.close('CAST');
      return { k: 'cast', e, type, at: at() };
    }
    if (t.kind === 'word' && UNREADABLE.includes(t.value)) refuse(`${t.text.toUpperCase()} has no place in the design grid`);
    // left() and right() are functions too.
    if (t.kind === 'word' && KEYWORDS.has(t.value) && !(['left', 'right'].includes(t.value) && this.op() === '(')) refuse(`${t.text.toUpperCase()} isn’t where the design grid expects it`);
    if (t.kind !== 'word' && t.kind !== 'quoted') return refuse(`${t.text} isn’t where the design grid expects it`);
    if (this.op() === '(' && t.kind === 'word') {
      this.i++;
      const distinct = this.isWord('distinct');
      if (distinct) this.i++;
      const args: Expr[] = [];
      const star = this.op() === '*' && this.peek(1)?.text === ')';
      if (star) this.i++;
      else if (this.op() !== ')') {
        args.push(this.expr());
        while (this.op() === ',') {
          this.i++;
          args.push(this.expr());
        }
      }
      this.close(`${t.text}(`);
      if (this.isWord('over', 'filter', 'within')) refuse(`${this.peek()!.text.toUpperCase()} has no place in the design grid`);
      return { k: 'call', name: t.value, distinct, star, args, at: at() };
    }
    if (this.op() !== '.') return { k: 'col', name: t, at: at() };
    this.i++;
    const n = this.take();
    if (n.kind === 'op' && n.text === '*') return { k: 'star', table: t, at: at() };
    if (n.kind !== 'word' && n.kind !== 'quoted') refuse(`${t.text}.${n.text} isn’t a column`);
    if (this.op() === '.') refuse(`${t.text}.${n.text}.… is more than a table and its column`);
    return { k: 'col', table: t, name: n, at: at() };
  }
}

/** Every token of a range read as one expression. */
function wholeExpr(q: Query, range: Range): Expr {
  const r = new Reader(q, range);
  const e = r.expr();
  if (!r.done) refuse(`${r.peek()!.text} isn’t where the design grid expects it`);
  return e;
}

/** Without the brackets round the whole of it. */
const unwrap = (e: Expr): Expr => (e.k === 'paren' ? unwrap(e.e) : e);

/** A range split at its commas outside brackets. */
function splitAtCommas(q: Query, [a, b]: Range): Range[] {
  const out: Range[] = [];
  let depth = 0;
  let start = a;
  for (let i = a; i < b; i++) {
    const t = q.tokens[i]!;
    if (t.kind !== 'op') continue;
    if (t.text === '(') depth++;
    if (t.text === ')') depth--;
    if (depth === 0 && t.text === ',') {
      out.push([start, i]);
      start = i + 1;
    }
  }
  out.push([start, b]);
  return out;
}

// ---- Totals and criteria ------------------------------------------------------------------------------------------

/** Summaries the Total row has, by the DuckDB functions that make them. */
const SUMMARIES: Record<string, QueryTotal> = {
  sum: 'sum',
  avg: 'avg',
  mean: 'avg',
  min: 'min',
  max: 'max',
  count: 'count',
  first: 'first',
  last: 'last',
  stddev_samp: 'stdev',
  stddev: 'stdev',
  var_samp: 'var',
  variance: 'var',
};

/** DuckDB aggregate functions, for telling a calculation over summaries from one over rows. */
const AGGREGATES = new Set([
  ...Object.keys(SUMMARIES),
  ...('any_value arg_max arg_min argmax argmin array_agg bit_and bit_or bit_xor bool_and bool_or corr count_star covar_pop covar_samp entropy favg fsum ' +
    'geomean group_concat histogram kahan_sum kurtosis list listagg mad max_by median min_by mode product quantile quantile_cont quantile_disc ' +
    'regr_slope skewness stddev_pop string_agg sumkahan var_pop').split(' '),
]);

const FLIPPED: Record<string, string> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
const literal = (x: Expr): string | undefined => {
  const v = unwrap(x);
  if (v.k === 'num') return v.text;
  if (v.k === 'str') return v.value;
  const n = v.k === 'neg' ? unwrap(v.e) : undefined;
  return n?.k === 'num' ? `-${n.text}` : undefined;
};
/** T, from CAST(T AS VARCHAR) as the designer writes it for matching text. */
const asText = (x: Expr): Expr => (x.k === 'cast' && ['varchar', 'text', 'string'].includes(x.type) ? unwrap(x.e) : x);

/** What a criterion is on, and its condition: the forms the designer writes, plain comparisons, and ILIKE. */
function readCriterion(q: Query, expr: Expr): { term: Expr; criteria: QueryCriteria } | undefined {
  const e = unwrap(expr);
  if (e.k === 'bin' && COMPARE_OPS.includes(e.op)) {
    const [l, r] = [literal(e.l), literal(e.r)];
    if (r != null && l == null) return { term: e.l, criteria: { op: e.op as QueryCriteriaOp, value: r } };
    if (l != null && r == null) return { term: e.r, criteria: { op: (FLIPPED[e.op] ?? e.op) as QueryCriteriaOp, value: l } };
    return undefined;
  }
  // contains(lower(CAST(T AS VARCHAR)), lower('v')), and starts_with and suffix the same way.
  const MATCHES: Record<string, QueryCriteriaOp> = { contains: 'contains', starts_with: 'starts', prefix: 'starts', suffix: 'ends', ends_with: 'ends' };
  if (e.k === 'call' && MATCHES[e.name] && e.args.length === 2 && !e.distinct) {
    const [a, b] = e.args.map(unwrap) as [Expr, Expr];
    if (a.k !== 'call' || a.name !== 'lower' || a.args.length !== 1) return undefined;
    const inner = b.k === 'call' && b.name === 'lower' && b.args.length === 1 ? unwrap(b.args[0]!) : undefined;
    const value = inner?.k === 'str' ? inner.value : b.k === 'str' && b.value === b.value.toLowerCase() ? b.value : undefined;
    return value == null ? undefined : { term: asText(unwrap(a.args[0]!)), criteria: { op: MATCHES[e.name]!, value } };
  }
  if (e.k === 'like' && e.op === 'ilike') {
    const m = /^(%?)([^%_\\]+)(%?)$/.exec(literal(e.pattern) ?? '');
    if (!m || (!m[1] && !m[3])) return undefined;
    return { term: asText(unwrap(e.e)), criteria: { op: m[1] && m[3] ? 'contains' : m[3] ? 'starts' : 'ends', value: m[2]! } };
  }
  // (T IS NULL OR trim(CAST(T AS VARCHAR)) = ''), and its opposite with IS NOT NULL, AND and <>.
  if (e.k === 'bin' && (e.op === 'or' || e.op === 'and')) {
    const [a, b] = [unwrap(e.l), unwrap(e.r)];
    const not = e.op === 'and';
    if (a.k !== 'isnull' || a.not !== not || b.k !== 'bin' || b.op !== (not ? '<>' : '=') || literal(b.r) !== '') return undefined;
    const trimmed = unwrap(b.l);
    if (trimmed.k !== 'call' || trimmed.name !== 'trim' || trimmed.args.length !== 1) return undefined;
    const same = shapeOf(tokens(q, asText(unwrap(trimmed.args[0]!)))) === shapeOf(tokens(q, unwrap(a.e)));
    return same ? { term: a.e, criteria: { op: not ? 'notEmpty' : 'empty', value: '' } } : undefined;
  }
  return undefined;
}

const tokens = (q: Query, e: Expr) => q.tokens.slice(e.at[0], e.at[1]);

/** A WHERE or HAVING as criteria rows: ORed rows of ANDed conditions. */
function criteriaRowsOf(q: Query, expr: Expr): Expr[][] {
  if (readCriterion(q, expr)) return [[expr]];
  const e = unwrap(expr);
  if (e.k === 'bin' && e.op === 'or') return [...criteriaRowsOf(q, e.l), ...criteriaRowsOf(q, e.r)];
  return [conjuncts(q, e)];
}

function conjuncts(q: Query, expr: Expr): Expr[] {
  if (readCriterion(q, expr)) return [expr];
  const e = unwrap(expr);
  if (e.k === 'bin' && e.op === 'and') return [...conjuncts(q, e.l), ...conjuncts(q, e.r)];
  if (e.k === 'bin' && e.op === 'or') return refuse(`${textOf(q, e.at)} puts OR inside a row of criteria, which the grid can’t lay out`);
  return refuse(`${textOf(q, e.at)} isn’t a condition the grid’s criteria can show`);
}

// ---- Reading a query ----------------------------------------------------------------------------------------------

/** What a field stands for: a column, a summary of one, or an expression (told apart by its shape). */
type Term = { port: number; column: string; total?: QueryTotal } | { expression: string; shape: string };
type Ref = { port: number; column: string };

/**
 * Read SQL back into a design. The tables are the Query's, with their columns; `current` gives the tables' places in
 * the designer and the ids to keep. Returns the design, or why the grid can't show the SQL.
 */
export function readQuerySql(sql: string, tables: QueryTable[], current: QuerySpec, ids: { field: () => string; join: () => string } = { field: () => newId('f'), join: () => newId('j') }): QuerySqlReading {
  const problem = querySqlProblem(sql, tables);
  if (problem) return { reason: problem };
  try {
    return { spec: read(sql, tables, current, ids) };
  } catch (e) {
    if (e instanceof Unmappable || e instanceof SqlRefusal) return { reason: e.message };
    throw e;
  }
}

/** The clauses the grid has, in the order SQL writes them. */
const CLAUSES = ['select', 'from', 'where', 'group', 'having', 'order', 'limit'] as const;
type Clause = (typeof CLAUSES)[number];
/** Clauses with no place in the grid. */
const OTHER_CLAUSES = ['offset', 'qualify', 'window', 'union', 'intersect', 'except', 'fetch', 'using', 'sample', 'tablesample'];

function read(sql: string, tables: QueryTable[], current: QuerySpec, ids: { field: () => string; join: () => string }): QuerySpec {
  const all = lexSql(sql).filter((t) => t.kind !== 'comment');
  while (all.length && all[all.length - 1]!.text === ';') all.pop();
  const q: Query = { sql, tokens: all };
  const text = (e: Expr | Range) => textOf(q, Array.isArray(e) ? e : e.at);
  const label = (port: number) => tables.find((t) => t.port === port)!.label;
  const columnsOf = (port: number) => tables.find((t) => t.port === port)!.columns;

  if (all[0]?.kind !== 'word' || all[0].value !== 'select') refuse(`${all[0] ? all[0].text.toUpperCase() : 'An empty query'} has no place in the design grid, which reads one SELECT`);

  // The clauses, at their keywords outside brackets.
  const clauses = new Map<Clause, Range>();
  let open: Clause | undefined;
  let depth = 0;
  for (let i = 0; i < all.length; i++) {
    const t = all[i]!;
    if (t.kind === 'op' && t.text === '(') depth++;
    if (t.kind === 'op' && t.text === ')') depth--;
    const w = t.kind === 'word' && depth === 0 ? t.value : undefined;
    if (w && OTHER_CLAUSES.includes(w)) refuse(`${t.text.toUpperCase()} has no place in the design grid`);
    if (!w || !(CLAUSES as readonly string[]).includes(w)) continue;
    const clause = w as Clause;
    if (clauses.has(clause)) refuse(`${t.text.toUpperCase()} comes twice, and the design grid reads one query`);
    if (open && CLAUSES.indexOf(clause) < CLAUSES.indexOf(open)) refuse(`${t.text.toUpperCase()} is out of order`);
    if (open) clauses.get(open)![1] = i;
    const by = clause === 'group' || clause === 'order';
    if (by && all[i + 1]?.value !== 'by') refuse(`${t.text.toUpperCase()} needs BY`);
    clauses.set(clause, [i + (by ? 2 : 1), all.length]);
    open = clause;
  }
  if (!clauses.has('from')) refuse('a query without FROM has no tables for the design grid');

  // FROM: the tables, and how each joins those before it.
  const names = querySqlNames(tables);
  const byName = new Map<string, number>();
  for (const [port, ns] of names) for (const n of ns) byName.set(n.toLowerCase(), port);
  const aliases = new Map<string, number>();
  const placed: number[] = [];
  const written: Array<{ port: number; kind: string }> = [];
  const joins: QueryJoin[] = [];
  const from = new Reader(q, clauses.get('from')!);
  const table = () => {
    const t = from.take();
    if (t.kind !== 'word' && t.kind !== 'quoted') refuse(`${t.text} after FROM has no place in the design grid, which reads the Query’s tables by name`);
    const port = byName.get(t.value) ?? refuse(`${t.text} isn’t one of this query’s tables`);
    if (placed.includes(port)) refuse(`${t.text} is read twice, and the design grid has each table once`);
    if (from.isWord('as')) from.i++;
    const a = from.peek();
    const alias = a && (a.kind === 'quoted' || (a.kind === 'word' && !KEYWORDS.has(a.value))) ? (from.i++, a.value) : t.value;
    if (aliases.has(alias)) refuse(`two tables are called ${alias}`);
    aliases.set(alias, port);
    placed.push(port);
    return port;
  };
  written.push({ port: table(), kind: 'FIRST' });
  while (!from.done) {
    if (from.op() === ',') {
      from.i++;
      written.push({ port: table(), kind: 'CROSS' });
      continue;
    }
    const w = from.word();
    let kind = 'INNER';
    if (w === 'left' || w === 'right' || w === 'full' || w === 'cross') kind = w.toUpperCase();
    if (w !== 'join') from.i++;
    if (w === 'left' || w === 'right' || w === 'full') {
      if (from.isWord('outer')) from.i++;
    } else if (w !== 'inner' && w !== 'cross' && w !== 'join') refuse(`${(w ?? from.peek(-1)?.text ?? '').toUpperCase()} has no place in the design grid’s joins`);
    from.takeWord('join');
    const before = [...placed];
    const port = table();
    written.push({ port, kind });
    if (kind === 'CROSS') continue;
    from.takeWord('on');
    const start = from.i;
    while (!from.done && !from.isWord('join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'asof', 'positional', 'anti', 'semi') && from.op() !== ',') from.i++;
    const lines: Expr[] = [];
    const flatten = (e: Expr): void => {
      const x = unwrap(e);
      if (x.k === 'bin' && x.op === 'and') [x.l, x.r].forEach(flatten);
      else lines.push(x);
    };
    flatten(wholeExpr(q, [start, from.i]));
    for (const l of lines) {
      if (l.k !== 'bin' || l.op !== '=' || unwrap(l.l).k !== 'col' || unwrap(l.r).k !== 'col') return refuse(`the join on ${text(l)} isn’t one field equal to another, which is all a join line can be`);
      const [a, b] = [column(unwrap(l.l) as ColExpr, [...before, port]), column(unwrap(l.r) as ColExpr, [...before, port])];
      const turned = a.port === port;
      if (turned === (b.port === port) || !before.includes(turned ? b.port : a.port)) refuse(`the join on ${text(l)} must run from ${label(port)} to a table before it`);
      // The SQL's kind is seen from the tables already joined: a line whose left end is the new table sees it turned.
      const k = kind.toLowerCase() as QueryJoinKind;
      joins.push({ id: '', left: a, right: b, kind: !turned ? k : k === 'left' ? 'right' : k === 'right' ? 'left' : k });
    }
  }
  const missing = tables.filter((t) => !placed.includes(t.port));
  if (missing.length) refuse(`it leaves out ${missing.map((t) => t.label).join(' and ')}, which the design grid always joins in. Take ${missing.length === 1 ? 'it' : 'them'} out of the query in design view first`);

  /** A column name, qualified or not, as the column of a table in FROM. */
  function column(e: ColExpr, within: number[] = placed): Ref {
    let ports = within;
    if (e.table) {
      const port = aliases.get(e.table.value);
      if (port == null || !within.includes(port)) return refuse(`there’s no table ${e.table.text} here`);
      ports = [port];
    }
    const found = ports.flatMap((port) => columnsOf(port).filter((c) => c.name.toLowerCase() === e.name.value).map((c) => ({ port, column: c.name })));
    if (!found.length) refuse(`${e.name.text} isn’t a column of ${ports.map(label).join(' or ')}`);
    if (found.length > 1) refuse(`${e.name.text} is in ${found.map((f) => label(f.port)).join(' and ')}: say which, as ${[...aliases].find(([, p]) => p === found[0]!.port)![0]}.${e.name.text}`);
    return found[0]!;
  }

  // SELECT: the grid's fields, in order.
  const select = clauses.get('select')!;
  let distinct = false;
  if (all[select[0]]?.value === 'distinct') {
    if (all[select[0] + 1]?.value === 'on') refuse('DISTINCT ON has no place in the design grid');
    distinct = true;
    select[0]++;
  } else if (all[select[0]]?.value === 'all') select[0]++;
  const group = clauses.get('group');
  const groupAll = !!group && group[1] - group[0] === 1 && all[group[0]]!.value === 'all';
  const usesAggregate = all.slice(...select).some((t, i, ts) => t.kind === 'word' && AGGREGATES.has(t.value) && ts[i + 1]?.text === '(');
  const totals = !!group || clauses.has('having') || usesAggregate;

  const fields: QueryField[] = [];
  const terms = new Map<string, Term>();
  const aliasOf = new Map<string, string>();
  const plain: QueryField[] = [];
  const add = (f: Omit<QueryField, 'id'>, term: Term) => {
    const field: QueryField = { id: ids.field(), ...f };
    fields.push(field);
    terms.set(field.id, term);
    return field;
  };
  /** A hidden field standing for a term, for criteria or a sort the shown fields can't take. */
  const hidden = (term: Term, like?: QueryField) =>
    add(
      like ? { port: like.port, column: like.column, show: false, sort: 'none', ...(like.total ? { total: like.total } : {}), ...(like.expression != null ? { expression: like.expression } : {}) } : { ...(term as Ref & { total?: QueryTotal }), show: false, sort: 'none' },
      term,
    );
  const sameTerm = (a: Term | undefined, b: Term) =>
    !!a && ('expression' in a ? 'expression' in b && a.shape === b.shape : !('expression' in b) && a.port === b.port && a.column === b.column && a.total === b.total);
  const fieldsFor = (term: Term) => fields.filter((f) => sameTerm(terms.get(f.id), term));

  /** A summary the Total row has: sum(t1.total), count(DISTINCT x). */
  const summaryOf = (x: Expr): (Ref & { total: QueryTotal }) | undefined => {
    const arg = x.k === 'call' && !x.star && x.args.length === 1 ? unwrap(x.args[0]!) : undefined;
    if (x.k !== 'call' || arg?.k !== 'col') return undefined;
    const total = x.distinct ? (x.name === 'count' ? 'countDistinct' : undefined) : SUMMARIES[x.name];
    return total && { ...column(arg), total };
  };
  /**
   * An expression's text with each table it names called as the designer calls it, t1 for input 1, since that's how
   * the query it runs reads them (the SQL view writes them back by name).
   */
  const designText = ([a, b]: Range) => {
    if (all.slice(a, b).some((t) => t.kind === 'word' && t.value === 'select')) refuse('a subquery has no place in the design grid');
    let out = '';
    let at = all[a]!.start;
    for (let i = a; i < b - 1; i++) {
      const t = all[i]!;
      const port = (t.kind === 'word' || t.kind === 'quoted') && all[i + 1]!.text === '.' ? aliases.get(t.value) : undefined;
      if (port == null) continue;
      out += sql.slice(at, t.start) + `t${port + 1}`;
      at = t.start + t.text.length;
    }
    return out + sql.slice(at, all[b - 1]!.start + all[b - 1]!.text.length);
  };
  const expressionTerm = (range: Range): Extract<Term, { expression: string }> => {
    const expression = designText(range);
    return { expression, shape: shapeOf(lexSql(expression)) };
  };
  /** What a term in WHERE, GROUP BY, HAVING or ORDER BY stands for. */
  const termOf = (e: Expr): Term => {
    const x = unwrap(e);
    if (x.k === 'col') return { ...column(x), ...(totals ? { total: 'group' as const } : {}) };
    return summaryOf(x) ?? expressionTerm(x.at);
  };

  for (const range of splitAtCommas(q, select)) {
    const [a] = range;
    let b = range[1];
    if (b <= a) refuse('a field is missing between two commas');
    // A new name: AS name, or a name straight after the field.
    let alias: string | undefined;
    const last = all[b - 1]!;
    const prev = b - 2 >= a ? all[b - 2] : undefined;
    const isName = last.kind === 'quoted' || (last.kind === 'word' && !KEYWORDS.has(last.value));
    if (isName && prev && (prev.value === 'as' || prev.kind === 'quoted' || (prev.kind === 'word' && !KEYWORDS.has(prev.value)) || prev.text === ')' || prev.kind === 'string' || prev.kind === 'number')) {
      alias = last.kind === 'quoted' ? last.text.slice(1, -1).replace(/""/g, '"') : last.text;
      b -= prev.value === 'as' ? 2 : 1;
    }
    let expr: Expr | undefined;
    try {
      expr = wholeExpr(q, [a, b]);
    } catch (e) {
      if (!(e instanceof Unmappable)) throw e;
    }
    const x = expr && unwrap(expr);
    if (x?.k === 'star') {
      if (alias) refuse('* can’t be renamed');
      if (totals) refuse('Totals work on single fields, not *');
      for (const port of x.table ? [aliases.get(x.table.value) ?? refuse(`there’s no table ${x.table.text} here`)] : placed) add({ port, column: '*', show: true, sort: 'none' }, { port, column: '*' });
      continue;
    }
    let f: QueryField;
    const summary = x && summaryOf(x);
    if (x?.k === 'col') {
      const term = termOf(x) as Ref & { total?: QueryTotal };
      f = add({ ...term, show: true, sort: 'none' }, term);
      plain.push(f);
    } else if (summary) f = add({ ...summary, show: true, sort: 'none' }, summary);
    else {
      // A calculation: the Total row's Expression, which works on summaries.
      if (!totals) refuse(`${text([a, b])} is a calculation, which the grid only has as a Totals Expression over summaries`);
      const term = expressionTerm(expr?.k === 'paren' ? expr.e.at : [a, b]);
      const named = new Set(all.slice(a, b).filter((t) => t.kind === 'word' || t.kind === 'quoted').map((t) => t.value));
      const home = placed.flatMap((port) => columnsOf(port).filter((c) => named.has(c.name.toLowerCase())).map((c) => ({ port, column: c.name })))[0] ?? { port: placed[0]!, column: columnsOf(placed[0]!)[0]?.name ?? refuse('its tables’ columns aren’t known yet') };
      f = add({ ...home, show: true, sort: 'none', total: 'expression', expression: term.expression }, term);
    }
    if (alias) aliasOf.set(f.id, alias);
  }

  // GROUP BY: every grouped column is a Group by field, added hidden when the SELECT doesn't show it.
  if (group && !groupAll) {
    const grouped = splitAtCommas(q, group).map((g) => {
      const e = unwrap(wholeExpr(q, g));
      if (e.k !== 'col') refuse(`grouping by ${text(g)} has no place in the design grid, which groups by fields`);
      return termOf(e);
    });
    for (const term of grouped) if (!fieldsFor(term).length) hidden(term);
    for (const f of plain) if (!grouped.some((g) => sameTerm(g, terms.get(f.id)!))) refuse(`${f.column} is neither grouped nor summarised: add it to GROUP BY, or summarise it`);
  } else if (totals && !groupAll && plain.length) refuse(`${plain[0]!.column} is neither grouped nor summarised: add it to GROUP BY, or summarise it`);

  // WHERE and HAVING: the criteria rows. One clause may have several rows (OR); the other's conditions go in each.
  const where = clauses.has('where') ? criteriaRowsOf(q, wholeExpr(q, clauses.get('where')!)) : [];
  const having = clauses.has('having') ? criteriaRowsOf(q, wholeExpr(q, clauses.get('having')!)) : [];
  if (where.length > 1 && having.length > 1) refuse('both WHERE and HAVING have OR, which the grid’s criteria rows can’t lay out');
  const tag = (row: Expr[] | undefined, place: 'where' | 'having') => (row ?? []).map((e) => ({ e, place }));
  const rows = (having.length > 1 ? having.map((h) => [...tag(where[0], 'where'), ...tag(h, 'having')]) : (where.length ? where : [[]]).map((w) => [...tag(w, 'where'), ...tag(having[0], 'having')])).filter((r) => r.length);
  rows.forEach((row, r) => {
    for (const { e, place } of row) {
      const c = readCriterion(q, e)!;
      const x = unwrap(c.term);
      let term: Term;
      if (place === 'where' && totals) {
        if (x.k !== 'col') refuse(`${text(c.term)} in WHERE isn’t a column, and a Where field filters on one`);
        term = { ...column(x as ColExpr), total: 'where' };
      } else {
        term = termOf(x);
        const known = fieldsFor(term);
        if ('expression' in term && !known.length) refuse(`${text(c.term)} isn’t one of the fields, and criteria in the grid are on its fields`);
        if (!('expression' in term) && term.total === 'group' && !known.length) refuse(`${text(c.term)} in HAVING isn’t grouped: add it to GROUP BY, or put the condition in WHERE`);
      }
      const field = fieldsFor(term).find((f) => !criteriaCell(f, r)) ?? hidden(term, fieldsFor(term)[0]);
      if (r === 0) field.criteria = c.criteria;
      else field.or = [...(field.or ?? []), ...Array<null>(Math.max(0, r - 1 - (field.or?.length ?? 0))).fill(null), c.criteria];
    }
  });

  // ORDER BY: the grid sorts left to right, so a sort it can't give that way goes on a hidden field at the end.
  if (clauses.has('order')) {
    let after = -1;
    const shown = fields.filter((f) => f.show);
    for (const [a, b] of splitAtCommas(q, clauses.get('order')!)) {
      const end = all[b - 1];
      const sort = end?.kind === 'word' && (end.value === 'asc' || end.value === 'desc') ? end.value : 'asc';
      const e = unwrap(wholeExpr(q, [a, sort === end?.value ? b - 1 : b]));
      let matches: QueryField[];
      let term: Term;
      if (e.k === 'num' && /^\d+$/.test(e.text)) {
        const f = shown[Number(e.text) - 1];
        if (!f || f.column === '*') refuse(`ORDER BY ${e.text} isn’t one of the fields`);
        matches = [f!];
        term = terms.get(f!.id)!;
      } else {
        const named = e.k === 'col' && !e.table ? shown.filter((f) => aliasOf.get(f.id)?.toLowerCase() === e.name.value) : [];
        term = named.length ? terms.get(named[0]!.id)! : termOf(e);
        matches = named.length ? named : fieldsFor(term);
        if (!matches.length && 'expression' in term) refuse(`sorting on ${text(e)} has no place in the design grid, which sorts on its fields`);
        if (!matches.length && !('expression' in term) && term.total === 'group') refuse(`sorting on ${text(e)} needs it grouped`);
      }
      const f = matches.find((m) => fields.indexOf(m) > after && m.sort === 'none') ?? hidden(term, matches[0]);
      f.sort = sort;
      after = fields.indexOf(f);
    }
  }

  // LIMIT: Top values, a count of rows. LIMIT ALL keeps every row.
  let limit: number | undefined;
  if (clauses.has('limit')) {
    const [a, b] = clauses.get('limit')!;
    const t = all[a];
    if (b - a !== 1 || !t || !(t.kind === 'number' ? /^\d+$/.test(t.text) && Number(t.text) > 0 : t.value === 'all'))
      refuse(`LIMIT ${text([a, b])} has no place in the design grid, whose Top values is a number of rows`);
    if (t!.kind === 'number') limit = Number(t!.text);
  }

  // Keep the ids of fields and join lines that are still there, so the grid keeps track of them.
  const spec: QuerySpec = {
    tables: current.tables,
    joins: joins.map((j) => ({ ...j, id: current.joins.find((c) => c.left.port === j.left.port && c.left.column === j.left.column && c.right.port === j.right.port && c.right.column === j.right.column)?.id ?? ids.join() })),
    fields: fields.map((f, i) => {
      const was = current.fields[i];
      return was && was.port === f.port && was.column === f.column ? { ...f, id: was.id } : f;
    }),
    distinct,
    totals,
    orRows: Math.max(0, rows.length - 1),
    ...(limit ? { limit } : {}),
  };
  // A new name that's the one the field gets anyway isn't kept.
  const defaults = defaultNames(spec);
  spec.fields = spec.fields.map((f, i) => {
    const alias = aliasOf.get(fields[i]!.id);
    return alias && alias !== defaults.get(f.id) ? { ...f, alias } : f;
  });

  // The designer joins tables in input order. With outer joins among three or more tables, the order matters.
  const plan = joinPlan(spec, placed)!;
  const outer = (k: string) => k === 'LEFT' || k === 'RIGHT' || k === 'FULL';
  const planned = [{ port: plan.first, kind: 'FIRST' }, ...plan.steps];
  if (placed.length > 2 && [...written, ...planned].some((s) => outer(s.kind)) && planned.some((p, i) => p.port !== written[i]!.port || p.kind !== written[i]!.kind))
    refuse('the designer joins tables in input order, and these outer joins are written in another order, which could give other rows');

  const problems = queryProblems(spec, tables);
  if (problems.length) refuse(problems[0]!.message.replace(/\.$/, ''));
  return spec;
}
