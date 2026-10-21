// What every report format says the same way: status words, times, counts and the file name.
import type { Status } from '../ui';
import type { IssueOutcome, QualityReport, ReportAnalysis, ReportFormat, ReportRule, ReportStatus } from './build';

export const STATUS_WORD: Record<ReportStatus, string> = {
  pass: 'Pass',
  warn: 'Warn',
  fail: 'Fail',
  overridden: 'Overridden',
  error: 'Can’t run',
  off: 'Off',
  pending: 'Checking',
};

/** The badge each status wears: an overridden rule still failed, so it keeps the fail colour with its own word. */
export const STATUS_BADGE: Record<ReportStatus, Status> = { pass: 'pass', warn: 'warn', fail: 'fail', overridden: 'fail', error: 'fail', off: 'neutral', pending: 'pending' };

export const FORMAT_INFO: Record<ReportFormat, { label: string; ext: string; mime: string }> = {
  markdown: { label: 'Markdown', ext: 'md', mime: 'text/markdown;charset=utf-8' },
  json: { label: 'JSON', ext: 'json', mime: 'application/json;charset=utf-8' },
  html: { label: 'HTML', ext: 'html', mime: 'text/html;charset=utf-8' },
};

/** A time in UTC, so a report reads the same wherever it is opened: "16 Oct 2026, 17:20 UTC". */
export const reportTime = (iso: string) => `${new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`;

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "3 rules: 2 pass, 1 overridden." */
export function summaryLine(r: QualityReport): string {
  const parts = (Object.keys(STATUS_WORD) as ReportStatus[]).filter((s) => r.summary[s]).map((s) => `${r.summary[s]} ${STATUS_WORD[s].toLowerCase()}`);
  return `${count(r.summary.rules, 'rule')}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}

export const OUTCOME_WORD: Record<IssueOutcome, string> = { fixed: 'Fixed', ignored: 'Ignored', open: 'Open' };

/** "7 issues found 16 Oct 2026, 17:20 UTC: 6 fixed, 1 ignored." */
export function analysisLine(a: ReportAnalysis): string {
  const parts = (Object.keys(OUTCOME_WORD) as IssueOutcome[]).filter((o) => a[o]).map((o) => `${a[o]} ${OUTCOME_WORD[o].toLowerCase()}`);
  return `${a.found ? count(a.found, 'issue') : 'No issues'} found ${reportTime(a.at)} in ${count(a.rows, 'row')}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}

/** The figures of one rule, e.g. "2 of 4 rows fail (50%)", or what stands in for them. */
export function ruleFigures(rule: ReportRule): string {
  if (rule.status === 'off') return 'Not checked: the rule is off.';
  if (rule.status === 'pending') return 'Not checked yet.';
  if (rule.total == null) return 'Not checked.';
  if (rule.scope === 'table') return `Whole table: ${count(rule.total, 'row')}.`;
  return `${(rule.failed ?? 0).toLocaleString('en-GB')} of ${count(rule.total, 'row')} fail (${rule.failedPercent ?? 0}%); ${(rule.passed ?? 0).toLocaleString('en-GB')} pass.`;
}

export const overrideLine = (rule: ReportRule) =>
  rule.override ? `Exported anyway on ${reportTime(rule.override.at)}, from ${rule.override.outputName} to ${rule.override.fileName}.` : '';

export const SAMPLE_NOTE = 'This report includes sample failing rows, which contain data from the project’s files.';
export const NO_DATA_NOTE = 'This report contains no row values: only counts and descriptions of the data.';
export const sampleModeNote = (rows: number) => `Some rules were checked on a sample (the first ${rows.toLocaleString('en-GB')} rows of each large source), so their counts are of sampled rows.`;
export const HEAD_HASH_NOTE = 'Head hash: SHA-256 of the first 1 MB of the file, to check it is the same file.';

/** "Sales quality report.md": the project's name, made safe for a file name. */
export function reportFileName(projectName: string, format: ReportFormat): string {
  const base = [...projectName.trim()]
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.+$/, '')
    .trim();
  return `${base || 'Project'} quality report.${FORMAT_INFO[format].ext}`;
}
