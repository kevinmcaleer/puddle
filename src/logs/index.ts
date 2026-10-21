/**
 * Log files. A log is one entry per line in a shape its writer chose: a web server's access log, syslog, an IIS
 * log with its own #Fields header, an application log with a timestamp and a level, or anything else a regular
 * expression with named groups can take apart. readLog reads a file as one of the presets, or as a custom pattern,
 * into columns and rows, which DuckDB types like any CSV (the rewrite path). detectLogPreset says which preset the
 * first lines of a file fit, for the sniff. Pure, shared with the runner.
 */

export type LogPresetId = 'combined' | 'syslog' | 'iis' | 'timestamped' | 'custom';

export interface LogPreset {
  id: LogPresetId;
  label: string;
  /** What the preset reads, for the inspector. */
  hint: string;
  /** Patterns tried in turn on each line, with named groups for the columns. */
  patterns: RegExp[];
  /** Columns in order: the union of the patterns' groups. */
  columns: string[];
  /** Whether a line that matches no pattern continues the entry before it (a stack trace under an app log line). */
  continues: boolean;
}

/** Access logs in the Apache and nginx combined and common formats. */
const COMBINED = /^(?<host>\S+) (?<ident>\S+) (?<user>\S+) \[(?<time>[^\]]+)\] "(?<request>[^"]*)" (?<status>\d{3}) (?<bytes>-|\d+)(?: "(?<referrer>[^"]*)" "(?<agent>[^"]*)")?/;
/** Syslog as RFC 5424 writes it, and the older BSD line (RFC 3164). */
const SYSLOG_5424 = /^<(?<priority>\d{1,3})>\d+ (?<time>\S+) (?<host>\S+) (?<process>\S+) (?<pid>\S+) (?<id>\S+) (?<data>-|(?:\[[^\]]*\])+) ?(?<message>.*)$/;
const SYSLOG_BSD = /^(?:<(?<priority>\d{1,3})>)?(?<time>[A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2}) (?<host>\S+) (?<process>[^\s[:]+)(?:\[(?<pid>\d+)\])?: ?(?<message>.*)$/;
/** An application log: a timestamp, an optional level, the message. Continuation lines (a stack trace) join the message. */
const TIMESTAMPED = /^(?<time>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?) +(?:[-|] +)?(?:\[?(?<level>TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|SEVERE|FATAL|CRITICAL)\]?:? +)?(?:[-|] +)?(?<message>.*)$/i;

export const LOG_PRESETS: LogPreset[] = [
  { id: 'combined', label: 'Web server access log (Apache, nginx)', hint: 'The combined and common log formats: host, user, time, request, status, bytes, referrer and user agent.', patterns: [COMBINED], columns: ['host', 'ident', 'user', 'time', 'method', 'path', 'protocol', 'status', 'bytes', 'referrer', 'agent'], continues: false },
  { id: 'syslog', label: 'Syslog', hint: 'Lines as syslog writes them, old style (Oct 11 22:14:15 host process[pid]: message) or RFC 5424.', patterns: [SYSLOG_5424, SYSLOG_BSD], columns: ['priority', 'time', 'host', 'process', 'pid', 'id', 'data', 'message'], continues: false },
  { id: 'iis', label: 'IIS log (W3C extended)', hint: 'Space-separated fields named by the #Fields: line IIS writes at the top of each log.', patterns: [], columns: [], continues: false },
  { id: 'timestamped', label: 'Application log (timestamp, level, message)', hint: 'Lines starting with a date and time, then a level such as INFO or ERROR, then the message. A line without a timestamp (a stack trace) joins the message above it.', patterns: [TIMESTAMPED], columns: ['time', 'level', 'message'], continues: true },
  { id: 'custom', label: 'Custom pattern', hint: 'A regular expression with a named group for each column, such as (?<time>\\S+) (?<level>\\w+) (?<message>.*). Lines it doesn’t match are left out.', patterns: [], columns: [], continues: false },
];

export const logPreset = (id: string | undefined): LogPreset => LOG_PRESETS.find((p) => p.id === id) ?? LOG_PRESETS[3]!;

export interface LogOptions {
  preset?: string;
  /** The custom pattern, as regular expression source. */
  pattern?: string;
}

export interface LogTable {
  columns: string[];
  rows: string[][];
  preset: LogPresetId;
  /** Lines that fit no pattern and were left out (comment lines and blank ones don't count). */
  unmatched: number;
}

export class LogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogError';
  }
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** An access log's time, 10/Oct/2000:13:55:36 -0700, as 2000-10-10 13:55:36-07:00, which DuckDB reads as a timestamp. */
export function accessLogTime(time: string): string {
  const m = /^(\d{1,2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}:\d{2}:\d{2})(?: ([+-])(\d{2})(\d{2}))?$/.exec(time);
  if (!m || !MONTHS[m[2]!]) return time;
  return `${m[3]}-${MONTHS[m[2]!]}-${m[1]!.padStart(2, '0')} ${m[4]}${m[5] ? `${m[5]}${m[6]}:${m[7]}` : ''}`;
}

const dash = (v: string | undefined) => (v == null || v === '-' ? '' : v);

/** The columns of a matched access log line: the request split into its method, path and protocol, the time as a timestamp. */
function accessRow(g: Record<string, string | undefined>): string[] {
  const request = g.request ?? '';
  const r = /^(\S+) (\S+)(?: (\S+))?$/.exec(request);
  return [dash(g.host), dash(g.ident), dash(g.user), accessLogTime(g.time ?? ''), r?.[1] ?? '', r?.[2] ?? (r ? '' : request), r?.[3] ?? '', dash(g.status), dash(g.bytes), dash(g.referrer), dash(g.agent)];
}

const splitLines = (text: string) => text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);

/** The names of a pattern's groups, in order; unnamed groups are numbered. */
export function patternColumns(pattern: RegExp): string[] {
  const names: string[] = [];
  let unnamed = 0;
  // Groups open with "(" not followed by "?" (unnamed) or by "?<name>" (named); "(?:", "(?=", lookbehinds and escaped parens don't count.
  const re = /\\.|\[(?:\\.|[^\]])*\]|\((\?<([A-Za-z_$][\w$]*)>)?(?!\?)/g;
  for (let m = re.exec(pattern.source); m; m = re.exec(pattern.source)) {
    if (m[0][0] !== '(') continue;
    names.push(m[2] ?? `group${++unnamed}`);
  }
  return names;
}

/** A custom pattern from its source, or why it can't be used. */
export function compilePattern(source: string | undefined): RegExp {
  if (!source?.trim()) throw new LogError('Enter a pattern: a regular expression with a named group for each column, such as (?<time>\\S+) (?<level>\\w+) (?<message>.*).');
  let re: RegExp;
  try {
    re = new RegExp(source);
  } catch (e) {
    throw new LogError(`The pattern isn’t a regular expression JavaScript accepts: ${e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : String(e)}.`);
  }
  if (!patternColumns(re).length) throw new LogError('The pattern has no groups: put each column in parentheses, named like (?<time>\\S+).');
  return re;
}

/** An IIS W3C extended log: the fields the last #Fields: line names, one space-separated value each. */
function readIis(lines: string[]): LogTable {
  let columns: string[] = [];
  const rows: string[][] = [];
  let unmatched = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('#')) {
      const m = /^#Fields:\s*(.*)$/.exec(line);
      if (m) columns = m[1]!.trim().split(/\s+/);
      continue;
    }
    const values = line.trim().split(/\s+/).map(dash);
    if (!columns.length || values.length < columns.length) {
      unmatched++;
      continue;
    }
    rows.push(values.slice(0, columns.length));
  }
  if (!columns.length) throw new LogError('There is no #Fields: line naming the columns, as an IIS log has at the top.');
  return { columns, rows, preset: 'iis', unmatched };
}

/** Read a log into columns and rows as the preset (or the custom pattern) says. */
export function readLog(text: string, o: LogOptions = {}): LogTable {
  const lines = splitLines(text);
  const preset = logPreset(o.preset);
  if (preset.id === 'iis') return readIis(lines);
  const patterns = preset.id === 'custom' ? [compilePattern(o.pattern)] : preset.patterns;
  const columns = preset.id === 'custom' ? patternColumns(patterns[0]!) : preset.columns;
  const rows: string[][] = [];
  let unmatched = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let matched = false;
    for (const pattern of patterns) {
      const m = pattern.exec(line);
      if (!m) continue;
      matched = true;
      if (preset.id === 'combined') rows.push(accessRow(m.groups ?? {}));
      else if (preset.id === 'custom') rows.push(m.groups ? columns.map((c) => m.groups![c] ?? m[columns.indexOf(c) + 1] ?? '') : m.slice(1).map((v) => v ?? ''));
      else rows.push(columns.map((c) => dash(m.groups?.[c])));
      break;
    }
    if (matched) continue;
    const last = rows[rows.length - 1];
    if (preset.continues && last) last[last.length - 1] = `${last[last.length - 1]}\n${line}`.trimEnd();
    else unmatched++;
  }
  return { columns, rows, preset: preset.id, unmatched };
}

/** The preset the first lines of a file fit (4 in 5 lines, or 3 in 5 with the first for a log whose entries run on), if any. */
export function detectLogPreset(lines: string[]): LogPresetId | undefined {
  const content = lines.filter((l) => l.trim().length > 0).slice(0, 200);
  if (content.length < 2) return undefined;
  if (content.some((l) => /^#Fields:\s/.test(l)) && content.some((l) => /^#Software: Microsoft/.test(l) || /^#Version:/.test(l))) return 'iis';
  for (const preset of LOG_PRESETS) {
    if (!preset.patterns.length) continue;
    const hits = content.filter((l) => preset.patterns.some((p) => p.test(l))).length;
    if (hits >= content.length * 0.8) return preset.id;
    if (preset.continues && hits >= content.length * 0.5 && preset.patterns.some((p) => p.test(content[0]!))) return preset.id;
  }
  return undefined;
}

export const logPresetLabel = (id: string | undefined) => logPreset(id).label;
