// puddle-run analyse <file>: what the Issues panel would list for a file, with no project: the file is sniffed as
// the editor sniffs it, read as the project would read it, and analysed with the same pure analysis.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { analyseWith, type NodeAnalysis } from '../analysis/analyse';
import { findIssues } from '../analysis/columns';
import { isReadOptionsFix, isStepFix, isStepsFix, issueLabel, sortIssues, type Issue } from '../analysis/issues';
import { compile } from '../compiler';
import { addSource, createProject, type ColumnSchema, type Project, type Source } from '../model';
import { HEAD_BYTES } from '../sources/hash';
import { sniff, TAIL_BYTES, type Sniffed } from '../sources/sniff';
import type { RunnerDb } from './db';
import { stageProject, type RunOptions } from './run';

/** Read `length` bytes of a file from `at`. */
function readBytes(path: string, at: number, length: number): Uint8Array {
  const fd = openSync(path, 'r');
  try {
    const out = new Uint8Array(length);
    const n = readSync(fd, out, 0, length, at);
    return out.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/** The format and read options a file wants, from its name, its first megabyte and its last lines, as the editor sniffs a file it is given. */
export function sniffFile(path: string): Sniffed {
  const size = statSync(path).size;
  const head = readBytes(path, 0, Math.min(size, HEAD_BYTES));
  const tail = size > HEAD_BYTES ? readBytes(path, Math.max(0, size - TAIL_BYTES), TAIL_BYTES) : undefined;
  return sniff({ name: basename(path), head, size, tail });
}

/** A project of one source: the file, as sniffed, read by one Source node. */
export function projectForFile(path: string, sniffed: Sniffed, size = 0, now = new Date()): { project: Project; nodeId: string } {
  const name = basename(path);
  const source: Source = {
    id: 'file',
    name,
    kind: 'file',
    format: sniffed.format,
    parseOptions: sniffed.parseOptions,
    detectedSchema: [],
    file: { originalName: name, size, lastModified: 0, headHash: '', path: resolve(path) },
  };
  return { project: addSource(createProject(name, now), source, { x: 0, y: 0 }, 'in'), nodeId: 'in' };
}

export interface FileAnalysis {
  name: string;
  format: Sniffed['format'];
  /** The project of one source the file was read through, for placing fixes after `nodeId`. */
  project: Project;
  nodeId: string;
  columns: ColumnSchema[];
  analysis: NodeAnalysis;
  issues: Issue[];
}

/** Sniff, read and analyse one file on the runner's DuckDB, as the editor analyses a source node when it has run. */
export async function analyseFile(path: string, db: RunnerDb, opts: Pick<RunOptions, 'fetchText' | 'fetchImpl'> = {}): Promise<FileAnalysis> {
  const file = resolve(path);
  const sniffed = sniffFile(file);
  const { project, nodeId } = projectForFile(file, sniffed, statSync(file).size);
  const staged = await stageProject(project, { ...opts, folder: dirname(file), db });
  try {
    const problem = staged.problems.get('file');
    if (problem) throw new Error(`${basename(file)} ${problem}`);
    const columns = await db.describe(compile(project, { nodeId }).sql);
    const analysis = await analyseWith({ rows: (sql) => db.query(sql) }, project, nodeId, columns);
    const issues = sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name));
    return { name: basename(file), format: sniffed.format, project, nodeId, columns, analysis, issues };
  } finally {
    staged.done();
  }
}

/** Steps whose type doesn't read as their name in the Add menu. */
const STEP_WORDS: Record<string, string> = { duplicateRows: 'Remove duplicate rows', removeNonPrinting: 'Remove non-printing characters', emptyToNull: 'Empty text to empty', parseBooleans: 'Parse yes and no' };

/** "trimWhitespace" as "Trim whitespace": the step's name, from its type, without the editor's forms. */
const stepWords = (type: string) => STEP_WORDS[type] ?? type.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** What Fix all would do about an issue, in words, or nothing when there is no fix. */
export function fixWords(issue: Issue): string | undefined {
  const fix = issue.fix;
  if (isReadOptionsFix(fix) || isStepsFix(fix)) return fix.label;
  if (isStepFix(fix)) return stepWords(fix.type);
  return undefined;
}

const SEVERITY: Record<Issue['severity'], string> = { fix: 'fix', suggest: 'suggest', info: 'info' };

/** The analysis as `puddle-run analyse` prints it: a line for the file, then one per issue. */
export function describeAnalysis(a: FileAnalysis): string[] {
  const rows = a.analysis.facts.rows;
  const lines = [`${a.name}: ${a.format.toUpperCase()}, ${rows.toLocaleString('en-GB')} ${rows === 1 ? 'row' : 'rows'}, ${a.columns.length} ${a.columns.length === 1 ? 'column' : 'columns'}`];
  if (a.analysis.facts.sample) lines.push(`  checked on the first ${a.analysis.facts.sample.rows.toLocaleString('en-GB')} rows`);
  if (!a.issues.length) {
    lines.push('  no issues found');
    return lines;
  }
  lines.push(`  ${a.issues.length} ${a.issues.length === 1 ? 'issue' : 'issues'}`);
  for (const i of a.issues) {
    const fix = fixWords(i);
    const count = i.count.toLocaleString('en-GB');
    lines.push(`  ${SEVERITY[i.severity].padEnd(7)} ${issueLabel(i)}: ${count} ${i.kind === 'mixedCase' ? (i.count === 1 ? 'value' : 'values') : i.count === 1 ? 'row' : 'rows'}${fix ? `. ${fix}` : ''}`);
  }
  return lines;
}
