// The analysis of one node's output, on any way of running SQL: the engine in the browser (state.ts), or the
// runner's DuckDB (puddle-run analyse). Pure: no stores, no React.
import { compileAnalysis, compileCount, compileDistinctFacts, compileProfile, compileShape, compileSkew, compileTypeSniff, compileValueCounts } from '../compiler';
import { detectDateFormatsWith } from '../dates';
import { nodeById, type ColumnSchema, type FoundIssue, type Project, type Source } from '../model';
import { parseProfile, parseTypeSniff, type ColumnProfile } from '../results/profile';
import { columnKind } from '../ui/columnKind';
import { analysisChecks, findIssues, parseAnalysis, parseDistinctFacts, parseValueCounts, type AnalysisFacts } from './columns';
import { issueLabel, sortIssues } from './issues';
import { parseShape } from './shape';
import { findSkew, parseSkew, skewFix } from './skew';

export interface NodeAnalysis {
  columns: ColumnSchema[];
  profile: Record<string, ColumnProfile>;
  facts: AnalysisFacts;
}

/** How many rows of a table are looked at: its first this many, when it has more, so a big file is analysed in seconds (three million taxi trips took minutes). */
export const ANALYSIS_ROWS = 200_000;

export interface AnalysisQueries {
  /** The rows of a query; `what` names the step for a progress label. */
  rows(sql: string, what: string): Promise<Record<string, unknown>[]>;
  /** The merged cells of a workbook source, when the reader has them (the browser's Excel worker). */
  sheetMerges?(source: Source): { merges: number; filled: boolean } | undefined;
}

/**
 * Count, profile and sniff a node's output (as the results table does), then one query for the exact counts, one
 * grouped per column for what the distinct values say, one for the values of columns with few of them, and for text
 * sources one for the rows that aren't data.
 */
export async function analyseWith(q: AnalysisQueries, project: Project, nodeId: string, columns: ColumnSchema[], sample = ANALYSIS_ROWS): Promise<NodeAnalysis> {
  const target = { nodeId };
  const total = Number(Object.values((await q.rows(compileCount(project, target), 'rows'))[0] ?? {})[0] ?? 0);
  // A big table is looked at through its first rows: the whole of three million rows of trips took minutes.
  const limit = total > sample ? sample : undefined;
  const profile = parseProfile(await q.rows(compileProfile(project, target, limit), 'columns'));
  const text = columns.filter((c) => columnKind(c.type) === 'text').map((c) => c.name);
  if (text.length) {
    const looks = parseTypeSniff((await q.rows(compileTypeSniff(project, target, text, limit), 'text'))[0] ?? {}, text);
    for (const [c, l] of Object.entries(looks)) if (profile[c]) profile[c] = { ...profile[c], ...l };
  }
  const checks = analysisChecks(columns, profile);
  const row = (await q.rows(compileAnalysis(project, target, checks, columns.map((c) => c.name), limit), 'values'))[0] ?? {};
  const facts = parseAnalysis(row, checks);
  facts.columnNames = project.settings.columnNames;
  if (limit) facts.sample = { rows: limit, total };
  if (checks.length) parseDistinctFacts(await q.rows(compileDistinctFacts(project, target, checks, limit), 'distinct values'), checks, facts.columns);
  const valued = checks.filter((c) => c.values).map((c) => c.column);
  if (valued.length) {
    const counts = parseValueCounts(await q.rows(compileValueCounts(project, target, valued, limit), 'value counts'));
    for (const c of valued) {
      const vc = counts[c] ?? [];
      facts.columns[c]!.valueCounts = vc;
      facts.columns[c]!.values = vc.map((v) => v.value).sort();
    }
  }
  // Rows whose cells sit a column to the left or right of where they belong: the kinds of every row, grouped.
  if (columns.length >= 2 && facts.rows >= 4) {
    const groups = parseSkew(await q.rows(compileSkew(project, target, columns, limit), 'rows out of line'));
    const skew = findSkew(columns.map((c) => c.name), groups);
    if (skew) {
      // Dates moved into a column come as text: from a date column as ISO, from a text column in whatever way it writes them.
      const { dateSources } = skewFix(columns, skew);
      const formats: Record<string, string[]> = {};
      for (const [column, sources] of Object.entries(dateSources)) {
        const found = new Set<string>();
        for (const name of sources) {
          const type = columns.find((c) => c.name === name)?.type.toUpperCase() ?? 'VARCHAR';
          if (type === 'DATE') found.add('%Y-%m-%d');
          else if (type.startsWith('TIMESTAMP')) found.add('%Y-%m-%d %H:%M:%S');
          else {
            const detection = await detectDateFormatsWith((sql) => q.rows(sql, 'dates'), project, target, name, project.settings.locale);
            for (const f of detection.formats ?? detection.ranked.slice(0, 1).map((r) => r.format)) found.add(f);
          }
        }
        formats[column] = [...found];
      }
      facts.skew = { skew, fix: skewFix(columns, skew, formats) };
    }
  }
  // A source read from delimited text or a sheet: one more query for the rows around and inside the table that aren't data.
  const source = textSourceOf(project, nodeId) ?? sheetSourceOf(project, nodeId);
  if (source && columns.length) {
    const shapeRow = (await q.rows(compileShape(project, target, columns.map((c) => c.name), limit), 'rows that aren’t data'))[0] ?? {};
    facts.shape = { facts: parseShape(shapeRow), options: source.parseOptions, ...(source.format === 'xlsx' ? { sheet: true } : {}) };
  }
  if (source?.format === 'xlsx') {
    const sheet = q.sheetMerges?.(source);
    if (sheet) facts.sheet = sheet;
  }
  return { columns, profile, facts };
}

/** The source a node reads, when it is an Excel workbook. */
export function sheetSourceOf(project: Project, nodeId: string) {
  const node = nodeById(project, nodeId);
  if (node?.type !== 'source') return undefined;
  const source = project.sources.find((s) => s.id === node.sourceId);
  return source && source.format === 'xlsx' && (source.kind === 'file' || source.kind === 'url') ? source : undefined;
}

/** The source a node reads, when it is text (CSV, TSV, fixed width or a pipe table from a file, an address or the clipboard). */
export function textSourceOf(project: Project, nodeId: string) {
  const node = nodeById(project, nodeId);
  if (node?.type !== 'source') return undefined;
  const source = project.sources.find((s) => s.id === node.sourceId);
  const text = source && (source.format === 'csv' || source.format === 'tsv' || source.format === 'fixed' || source.format === 'pipes');
  return text && !source.url?.odata && !source.url?.table ? source : undefined;
}

/** Every issue of an analysis, the ignored ones included, as the project keeps them: no examples from the data. */
export function foundIssues({ columns, profile, facts }: NodeAnalysis): FoundIssue[] {
  return sortIssues(findIssues(columns, profile, facts), columns.map((c) => c.name)).map((i) => ({
    key: i.key,
    kind: i.kind,
    ...(i.column != null ? { column: i.column } : {}),
    ...(i.value != null ? { value: i.value } : {}),
    label: issueLabel(i),
    count: i.count,
  }));
}
