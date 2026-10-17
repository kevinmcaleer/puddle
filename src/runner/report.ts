// The quality report a run leaves beside its outputs: every enabled rule's result, as Markdown. Pure.
import type { RuleResult } from '../flow/ruleResult';
import type { Project } from '../model';

const STATUS: Record<string, string> = { pass: 'Pass', warn: 'Warning', fail: 'Fail', error: 'Can’t run', pending: 'Not checked' };

/** One rule's standing from its result and severity. */
export function ruleStatus(severity: 'warn' | 'fail', r: RuleResult | undefined): keyof typeof STATUS {
  if (!r || r.state === 'pending') return 'pending';
  if (r.state === 'error') return 'error';
  return r.failures > 0 ? severity : 'pass';
}

/** The report: a heading, one line of totals, then a table per node that has enabled rules. */
export function qualityMarkdown(project: Project, results: Record<string, Record<string, RuleResult>>, generatedAt: string): string {
  const lines = [`# Quality report: ${project.name}`, '', `Generated ${generatedAt} by puddle-run.`, ''];
  const nodes = project.nodes.filter((n) => n.rules.some((r) => r.enabled));
  const tally = { pass: 0, warn: 0, fail: 0, error: 0, pending: 0 };
  for (const n of nodes) for (const r of n.rules.filter((r) => r.enabled)) tally[ruleStatus(r.severity, results[n.id]?.[r.id]) as keyof typeof tally] += 1;
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  if (!total) return [...lines, 'No rules are set on this project.', ''].join('\n');
  lines.push(`${total} ${total === 1 ? 'rule' : 'rules'}: ${tally.pass} pass, ${tally.warn} warn, ${tally.fail} fail${tally.error ? `, ${tally.error} can’t run` : ''}${tally.pending ? `, ${tally.pending} not checked` : ''}.`, '');
  for (const n of nodes) {
    lines.push(`## ${n.name}`, '', '| Rule | Severity | Result | Failing rows |', '| --- | --- | --- | --- |');
    for (const r of n.rules.filter((r) => r.enabled)) {
      const res = results[n.id]?.[r.id];
      const status = STATUS[ruleStatus(r.severity, res)]!;
      const rows = res?.state === 'ok' ? `${res.failures} of ${res.total}` : res?.state === 'error' ? res.message.replace(/\|/g, '\\|') : '';
      lines.push(`| ${r.label.replace(/\|/g, '\\|')} | ${r.severity} | ${status} | ${rows} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
