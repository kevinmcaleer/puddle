// The report as React elements, laid out as the rules panel lays out rules (RuleRow, QualityBar, StatusBadge).
import { QualityBar, StatusBadge } from '../ui';
import type { QualityReport, ReportNode, ReportRule } from './build';
import { HEAD_HASH_NOTE, NO_DATA_NOTE, overrideLine, reportTime, ruleFigures, SAMPLE_NOTE, sampleModeNote, STATUS_BADGE, STATUS_WORD, summaryLine } from './words';

function SampleTable({ rule }: { rule: ReportRule }) {
  const sample = rule.sample!;
  if (sample.error) return <p className="report-rule__sample type-label text-fail">The failing rows couldn’t be read: {sample.error}</p>;
  return (
    <div className="report-rule__sample">
      <p className="type-label">Failing rows{rule.failed != null && rule.failed > sample.rows.length ? ` (first ${sample.rows.length.toLocaleString('en-GB')} of ${rule.failed.toLocaleString('en-GB')})` : ''}</p>
      <table className="ui-grid">
        <thead>
          <tr>
            {sample.columns.map((c) => (
              <th key={c} className="ui-col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (v == null ? <td key={j} className="null">empty</td> : <td key={j}>{v}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One rule as RuleRow lays it out: badge, name and figure, then what it checks, its bar and anything else to say. */
function Rule({ rule }: { rule: ReportRule }) {
  const meta = [rule.kindLabel, `${rule.severity === 'fail' ? 'Fail' : 'Warn'} severity`, rule.columns.length ? rule.columns.join(', ') : ''].filter(Boolean).join(' · ');
  return (
    <div className="ui-rule" data-status={rule.status}>
      <span className="ui-rule__sev">
        <StatusBadge status={STATUS_BADGE[rule.status]}>{STATUS_WORD[rule.status]}</StatusBadge>
      </span>
      <span className="ui-rule__name">{rule.label}</span>
      <span className="ui-metric">{rule.failedPercent == null ? '' : `${rule.failedPercent}% fail`}</span>
      <span className="ui-rule__expr">{meta}</span>
      <span className="ui-rule__expr">{ruleFigures(rule)}</span>
      {rule.failed != null && rule.total ? (
        <span className="report-rule__bar">
          <QualityBar valid={rule.passed ?? 0} error={rule.failed} />
        </span>
      ) : null}
      {rule.override && <span className="report-rule__override type-label">Overridden. {overrideLine(rule)}</span>}
      {rule.error && <span className="ui-rule__expr text-fail">{rule.error}</span>}
      {rule.sample && <SampleTable rule={rule} />}
    </div>
  );
}

function Node({ node }: { node: ReportNode }) {
  return (
    <section className="report-card">
      <h2 className="type-heading">{node.name}</h2>
      {node.onSample && <p className="type-label">Checked on the sample, so counts are of sampled rows.</p>}
      {node.rules.length ? node.rules.map((r) => <Rule key={r.id} rule={r} />) : <p className="type-body">No rules.</p>}
    </section>
  );
}

export function ReportDocument({ report: r }: { report: QualityReport }) {
  return (
    <main className="report">
      <header className="report-head">
        <p className="ui-eyebrow">Quality report</p>
        <h1 className="type-title">{r.project.name}</h1>
        <p className="type-body">Generated {reportTime(r.generatedAt)} by Puddle.</p>
        <p className="type-body-strong">{summaryLine(r)}</p>
        <p className={r.sampleLimit > 0 ? 'report-note report-note--data type-label' : 'report-note type-label'}>{r.sampleLimit > 0 ? SAMPLE_NOTE : NO_DATA_NOTE}</p>
        {r.sampleRows != null && <p className="report-note type-label">{sampleModeNote(r.sampleRows)}</p>}
      </header>
      <section className="report-card">
        <h2 className="type-heading">Sources</h2>
        {r.sources.length ? (
          <>
            <table className="report-table type-body">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Format</th>
                  <th className="num">Rows</th>
                  <th>Head hash</th>
                </tr>
              </thead>
              <tbody>
                {r.sources.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.format}</td>
                    <td className="num ui-mono">{s.rows == null ? 'Couldn’t be read' : s.rows.toLocaleString('en-GB')}</td>
                    <td className="report-hash type-code">{s.headHash ?? 'Not known'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="type-label">{HEAD_HASH_NOTE}</p>
          </>
        ) : (
          <p className="type-body">No sources.</p>
        )}
      </section>
      {r.nodes.map((n) => (
        <Node key={n.id} node={n} />
      ))}
    </main>
  );
}
