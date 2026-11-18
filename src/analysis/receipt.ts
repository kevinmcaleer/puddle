// The receipt of a Fix all: what was fixed in a node's data and by which step, read from the analysis kept with the
// node (see recordAnalysis) and the steps still in the project. Nothing here runs a query.
import { fixedIssueKeys, nodeById, sourceProjectName, topoSort, type Project, type RecordedIssue } from '../model';

export interface ReceiptIssue {
  key: string;
  label: string;
  /** How much of the data it touched: "3 rows", or "2 values" for an issue counted in values. */
  touched: string;
}

export interface ReceiptLine {
  key: string;
  /** What did the fixing: the step's label, or the change to how the source is read. */
  label: string;
  /** The node to open: the step's Transform, or the source for a read option. */
  nodeId: string;
  stepId?: string;
  stepIndex?: number;
  /** The step is turned off, so its issues are open again. */
  off: boolean;
  issues: ReceiptIssue[];
}

export interface Receipt {
  nodeId: string;
  nodeName: string;
  /** When Fix all last ran here, as an ISO instant, and how many rows it had checked. */
  at: string;
  rows: number;
  /** How many issues the lines fix between them. */
  fixed: number;
  lines: ReceiptLine[];
  /** The node holding the fixed rows: the last step's, or the node itself when only read options changed. */
  lastNodeId: string;
}

/** Issues counted in distinct values, not rows, as the Issues panel counts them. */
const IN_VALUES = new Set(['mixedCase']);

const count = (n: number) => n.toLocaleString('en-GB');

export function touched(issue: Pick<RecordedIssue, 'kind' | 'count'>): string {
  const unit = IN_VALUES.has(issue.kind) ? 'value' : 'row';
  return `${count(issue.count)} ${unit}${issue.count === 1 ? '' : 's'}`;
}

/**
 * The receipt for the node Fix all ran on: one line per step it added that is still there, in the order they run,
 * each with the issues it fixes; before them, one line for the issues fixed by reading the source differently.
 * A deleted step has no line. Undefined when the node has no fixes left to show.
 */
export function fixReceipt(project: Project, nodeId: string): Receipt | undefined {
  const node = nodeById(project, nodeId);
  const record = node?.analysis;
  if (!node || !record) return undefined;
  const fixed = record.issues.filter((i) => i.fixed);
  const item = (i: RecordedIssue): ReceiptIssue => ({ key: i.key, label: i.label, touched: touched(i) });
  const lines: ReceiptLine[] = [];
  const read = fixed.filter((i) => i.fixedByRead);
  if (read.length) lines.push({ key: 'read', label: 'Read options', nodeId, off: false, issues: read.map(item) });
  const wanted = new Set(fixed.flatMap((i) => i.fixedBy ?? []));
  if (wanted.size) {
    for (const id of topoSort(project)) {
      const n = nodeById(project, id);
      if (n?.type !== 'transform') continue;
      n.steps.forEach((step, stepIndex) => {
        if (!wanted.has(step.id)) return;
        lines.push({ key: step.id, label: step.label, nodeId: n.id, stepId: step.id, stepIndex, off: !step.enabled, issues: fixed.filter((i) => i.fixedBy?.includes(step.id)).map(item) });
      });
    }
  }
  if (!lines.length) return undefined;
  const keys = new Set(lines.flatMap((l) => l.issues.map((i) => i.key)));
  return { nodeId, nodeName: node.name, at: record.at, rows: record.rows, fixed: keys.size, lines, lastNodeId: lines.at(-1)!.nodeId };
}

/**
 * How many of a node's issues stand fixed: those a step still in the project and turned on fixes, and those fixed by
 * reading the source differently, which analysis no longer finds. The node's badge shows this, so it says the same
 * number as the receipt's title while no fixing step is turned off.
 */
export function fixedCount(project: Project, nodeId: string): number {
  const recorded = nodeById(project, nodeId)?.analysis?.issues.filter((i) => i.fixed) ?? [];
  if (!recorded.length) return 0;
  const bySteps = fixedIssueKeys(project, nodeId);
  return recorded.filter((i) => i.fixedByRead || bySteps.has(i.key)).length;
}

/**
 * What saving a receipt's fixes as a template starts from: the Transform nodes holding its steps, in the order they
 * run, the steps to tick (the ones Fix all added, not a step of the user's own beside them), and a name after the
 * file. Undefined when only read options changed: a template keeps steps, and there are none.
 */
export function receiptTemplate(receipt: Receipt): { name: string; nodeIds: string[]; stepIds: string[] } | undefined {
  const steps = receipt.lines.filter((l) => l.stepId);
  if (!steps.length) return undefined;
  return { name: `${sourceProjectName({ name: receipt.nodeName })} fixes`, nodeIds: [...new Set(steps.map((l) => l.nodeId))], stepIds: steps.map((l) => l.stepId!) };
}

/** The node whose Fix all added a step in any of these nodes (those of a Fixes group, say), if one did. */
export function receiptNodeOf(project: Project, nodeIds: string[]): string | undefined {
  const steps = new Set(nodeIds.flatMap((id) => {
    const n = nodeById(project, id);
    return n?.type === 'transform' ? n.steps.map((s) => s.id) : [];
  }));
  if (!steps.size) return undefined;
  return project.nodes.find((n) => n.analysis?.issues.some((i) => i.fixed && i.fixedBy?.some((id) => steps.has(id))))?.id;
}

/** "Fixed 7 issues" */
export const receiptTitle = (r: Receipt) => `Fixed ${count(r.fixed)} ${r.fixed === 1 ? 'issue' : 'issues'}`;
