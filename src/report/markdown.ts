// The report as Markdown: reads as plain text, and pastes into tickets and wikis as tables.
import type { QualityReport, ReportRule } from './build';
import { count, HEAD_HASH_NOTE, NO_DATA_NOTE, overrideLine, reportTime, ruleFigures, SAMPLE_NOTE, sampleModeNote, STATUS_WORD, summaryLine } from './words';

/** One table cell: pipes escaped, line breaks flattened, so a value can't break the table. */
const cell = (v: string | number | null | undefined) =>
  v == null ? '' : String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');

/** Text outside tables: Markdown's own characters escaped, so a name reads as written. */
const text = (v: string) => v.replace(/([\\`*_[\]<>#|])/g, '\\$1').replace(/\r?\n|\r/g, ' ');

const table = (head: string[], rows: (string | number | null | undefined)[][]) =>
  [`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const num = (n: number | null) => (n == null ? '' : n.toLocaleString('en-GB'));

function ruleDetail(rule: ReportRule): string[] {
  const out: string[] = [];
  if (rule.override) out.push(`- **${text(rule.label)}**: overridden. ${overrideLine(rule)}`);
  if (rule.error) out.push(`- **${text(rule.label)}** can’t run: ${text(rule.error)}`);
  if (rule.sample) {
    out.push('', `#### Failing rows: ${text(rule.label)}`, '');
    if (rule.sample.error) out.push(`The failing rows couldn’t be read: ${text(rule.sample.error)}`);
    else {
      out.push(table(rule.sample.columns, rule.sample.rows));
      if (rule.failed != null && rule.failed > rule.sample.rows.length) out.push('', `First ${rule.sample.rows.length.toLocaleString('en-GB')} of ${count(rule.failed, 'failing row')}.`);
    }
  }
  return out;
}

export function reportMarkdown(r: QualityReport): string {
  const out: string[] = [`# Quality report: ${text(r.project.name)}`, '', `Generated ${reportTime(r.generatedAt)} by Puddle.`, '', `**${summaryLine(r)}**`, ''];
  out.push(`> ${r.sampleLimit > 0 ? SAMPLE_NOTE : NO_DATA_NOTE}`);
  if (r.sampleRows != null) out.push('>', `> ${sampleModeNote(r.sampleRows)}`);
  out.push('', '## Sources', '');
  if (r.sources.length) {
    out.push(table(['Source', 'Format', 'Rows', 'Head hash'], r.sources.map((s) => [s.name, s.format, s.rows == null ? 'Couldn’t be read' : num(s.rows), s.headHash ? `\`${s.headHash}\`` : 'Not known'])));
    out.push('', HEAD_HASH_NOTE);
  } else out.push('No sources.');
  for (const node of r.nodes) {
    out.push('', `## ${text(node.name)}`, '');
    if (node.onSample) out.push('Checked on the sample, so counts are of sampled rows.', '');
    if (!node.rules.length) {
      out.push('No rules.');
      continue;
    }
    out.push(
      table(
        ['Status', 'Rule', 'Kind', 'Severity', 'Columns', 'Rows', 'Pass', 'Fail', 'Fail %'],
        node.rules.map((rule) => [
          STATUS_WORD[rule.status],
          rule.label,
          rule.kindLabel,
          rule.severity === 'fail' ? 'Fail' : 'Warn',
          rule.columns.join(', '),
          num(rule.total),
          num(rule.passed),
          num(rule.failed),
          rule.failedPercent == null ? '' : `${rule.failedPercent}%`,
        ]),
      ),
    );
    const details = node.rules.flatMap((rule) => {
      const d = ruleDetail(rule);
      // Rules with nothing but counts are fully in the table; ones not checked say why.
      return d.length ? d : rule.total == null && rule.status !== 'off' ? [`- **${text(rule.label)}**: ${ruleFigures(rule)}`] : [];
    });
    if (details.length) out.push('', ...details);
  }
  return `${out.join('\n')}\n`;
}
