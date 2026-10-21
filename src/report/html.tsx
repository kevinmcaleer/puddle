// The report as one self-contained HTML file: the design system's tokens and components inlined, on light surfaces
// that print well. Rendered as static markup, so puddle-run writes the same file with no DOM.
import { renderToStaticMarkup } from 'react-dom/server';
import componentsCss from '../design-system/components.css?raw';
import tokensCss from '../design-system/tokens.css?raw';
import type { QualityReport } from './build';
import { ReportDocument } from './ReportDocument';

/** The report's own layout, from tokens only. */
const REPORT_CSS = `
body { margin: 0; background: var(--surface-panel); }
.report { max-width: calc(var(--size-inspector) * 3); margin: 0 auto; padding: var(--space-8) var(--space-6); display: flex; flex-direction: column; gap: var(--space-6); }
.report h1, .report h2, .report h3, .report p { margin: 0; }
.report-head { display: flex; flex-direction: column; gap: var(--space-2); }
.report-note { padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--ink-muted); }
.report-note--data { background: var(--warn-tint); color: var(--warn); }
.report-card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-raised); }
.report-table { border-collapse: collapse; width: 100%; }
.report-table th, .report-table td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.report-table th { color: var(--ink-muted); }
.report-table td.num { text-align: right; }
.report-hash { word-break: break-all; }
.report-issues { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-2); }
.report .ui-rule { border-bottom: 1px solid var(--line); border-radius: 0; }
.report .ui-rule:last-child { border-bottom: 0; }
.report .ui-rule:hover { background: none; }
.report .ui-rule__name, .report .ui-rule__expr { white-space: normal; overflow: visible; }
.report-rule__bar { grid-column: 2 / 4; }
.report-rule__override { grid-column: 2 / 4; color: var(--fail); }
.report-rule__sample { grid-column: 1 / 4; overflow-x: auto; }
.report .text-fail { color: var(--fail); }
/* Kept as written: spaces at either end are often what the rule caught. */
.report-rule__sample td { white-space: pre; }
.report .ui-grid { width: 100%; }
.report .ui-grid th { padding: 0 var(--space-2); background: var(--surface-sunken); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
@media print {
  body, .report-card { background: none; }
  .report { padding: 0; max-width: none; }
  .report-card, .ui-rule { break-inside: avoid; }
  .report-rule__sample { overflow: visible; }
}
`;

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function reportHtml(report: QualityReport): string {
  const title = `Quality report: ${report.project.name}`;
  const body = renderToStaticMarkup(<ReportDocument report={report} />);
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Puddle">
<title>${escapeText(title)}</title>
<style>
${tokensCss}
${componentsCss}
${REPORT_CSS}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
