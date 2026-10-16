// Column mapping: which columns a run of steps reads, which of them a new input lacks, and the steps rewritten for
// the columns picked in their place. Pure, so templates and whole-pipeline recipes can share it.
import { renameSqlColumns, sqlColumnRefs } from '../compiler';
import { newId, type ColumnSchema, type Step } from '../model';
import { relabel, stepForm } from '../steps';

type Params = Record<string, unknown>;

const isObject = (v: unknown): v is Params => typeof v === 'object' && v !== null && !Array.isArray(v);
const each = (v: unknown, f: (item: unknown) => unknown) => (Array.isArray(v) ? v.map(f) : v);
const lower = (name: string) => name.toLowerCase();

/**
 * The step's settings with every column name passed through `name`, and every expression or query through `sql`.
 * The step's editor form says which settings hold columns; settings a form hides for the current choice are left.
 */
function mapParams(step: Pick<Step, 'type' | 'params'>, name: (column: string) => string, sql: (text: string) => string): Params {
  const params: Params = { ...step.params };
  const form = stepForm(step.type);
  if (!form) return params;
  const col = (v: unknown) => (typeof v === 'string' && v !== '' ? name(v) : v);
  const keyed = (v: unknown, key: string) => each(v, (item) => (isObject(item) ? { ...item, [key]: col(item[key]) } : item));
  const seen = new Set<string>();
  for (const field of form.fields) {
    if (seen.has(field.key) || (field.when && !field.when(step.params))) continue;
    seen.add(field.key);
    const v = params[field.key];
    switch (field.kind) {
      case 'columns':
        params[field.key] = each(v, col);
        break;
      case 'column':
        params[field.key] = col(v);
        break;
      case 'renames':
        params[field.key] = keyed(v, 'from');
        break;
      case 'conditions':
      case 'sortKeys':
        params[field.key] = keyed(v, 'column');
        break;
      case 'expression':
      case 'sql':
        if (typeof v === 'string') params[field.key] = sql(v);
        break;
      case 'pivot':
        // The pivot editor edits the whole of the step's settings.
        params.rows = each(params.rows, col);
        params.column = col(params.column);
        params.values = keyed(params.values, 'column');
        params.filters = keyed(params.filters, 'column');
        break;
      case 'transposeRows':
        params.columns = each(params.columns, col);
        break;
    }
  }
  return params;
}

/**
 * The columns a step reads. Settings that pick columns count whatever they name; an expression or query counts
 * only the `candidates` it names, since any other word in it may be a function or a keyword.
 */
export function stepColumns(step: Pick<Step, 'type' | 'params'>, candidates: string[] = []): string[] {
  const found: string[] = [];
  mapParams(
    step,
    (c) => (found.push(c), c),
    (text) => (found.push(...sqlColumnRefs(text, candidates)), text),
  );
  return [...new Set(found)];
}

/** The input columns a run of steps reads, in the input's order: what a template says it expects. */
export function expectedColumns(steps: Pick<Step, 'type' | 'params'>[], input: ColumnSchema[]): ColumnSchema[] {
  const names = input.map((c) => c.name);
  const read = new Set(steps.flatMap((s) => stepColumns(s, names)).map(lower));
  return input.filter((c) => read.has(lower(c.name)));
}

/** "Customer Name", "customer_name" and "customerName" all read as "customername". */
const loose = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export interface ColumnMatch {
  /** The column the steps expect. */
  expected: ColumnSchema;
  /** The input column of the same name (ignoring case, as DuckDB does), if there is one. */
  found?: string;
  /** For a missing column: an input column whose name reads the same apart from case, spaces and punctuation. */
  suggestion?: string;
}

/** Each expected column against the input's: found by name, or missing with a suggested stand-in. */
export function matchColumns(expected: ColumnSchema[], actual: ColumnSchema[]): ColumnMatch[] {
  return expected.map((e) => {
    const found = actual.find((a) => a.name === e.name) ?? actual.find((a) => lower(a.name) === lower(e.name));
    if (found) return { expected: e, found: found.name };
    const suggestion = actual.find((a) => loose(a.name) === loose(e.name) && !expected.some((x) => lower(x.name) === lower(a.name)));
    return { expected: e, suggestion: suggestion?.name };
  });
}

/** Expected columns the input lacks, which ask for a column to use in their place. */
export const missingColumns = (expected: ColumnSchema[], actual: ColumnSchema[]) => matchColumns(expected, actual).filter((m) => !m.found);

/** The starting choice for each missing column: its suggestion, if any. Columns left out stay unmapped. */
export function suggestedMapping(expected: ColumnSchema[], actual: ColumnSchema[]): Record<string, string> {
  return Object.fromEntries(missingColumns(expected, actual).flatMap((m) => (m.suggestion ? [[m.expected.name, m.suggestion]] : [])));
}

const listed = (names: string[]) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Why a step arrives turned off. */
export const unmappedReason = (columns: string[]) => `Needs ${listed(columns)}, which the input doesn’t have. Pick ${columns.length === 1 ? 'a column' : 'columns'} in the step settings, then turn it on.`;

/**
 * Steps ready for an input with `actual` columns: every column in `mapping` (expected name to an input column) is
 * renamed in their settings, and a step that reads an expected column that is neither in the input nor mapped
 * arrives turned off, saying which. Steps get new ids, and labels follow their new settings unless renamed.
 */
export function mapSteps(steps: Step[], expected: ColumnSchema[], actual: ColumnSchema[], mapping: Record<string, string | undefined>): Step[] {
  const names = expected.map((c) => c.name);
  const renames: Record<string, string> = {};
  const unmapped = new Set<string>();
  for (const m of matchColumns(expected, actual)) {
    const to = mapping[m.expected.name];
    // A column found under another case works as it is in DuckDB; settings still take the input's spelling.
    if (m.found) {
      if (m.found !== m.expected.name) renames[m.expected.name] = m.found;
      continue;
    }
    if (to && actual.some((a) => a.name === to)) renames[m.expected.name] = to;
    else unmapped.add(lower(m.expected.name));
  }
  const renamesLower = new Map(Object.entries(renames).map(([from, to]) => [lower(from), to]));
  return steps.map((step) => {
    const lacking = stepColumns(step, names).filter((c) => unmapped.has(lower(c)));
    const params = mapParams(
      step,
      (c) => renamesLower.get(lower(c)) ?? c,
      (text) => renameSqlColumns(text, renames),
    );
    const { origin: _o, disabledReason: _r, ...plain } = step;
    const next = relabel({ ...plain, id: newId('st'), params });
    if (!lacking.length) return next;
    const shown = lacking.map((c) => expected.find((e) => lower(e.name) === lower(c))?.name ?? c);
    return { ...next, enabled: false, disabledReason: unmappedReason([...new Set(shown)]) };
  });
}
