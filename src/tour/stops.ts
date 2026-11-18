import type { Project } from '../model';

/** What a stop can look at to decide where it points and whether its action is done. */
export interface TourContext {
  project: Project;
  /** Column names selected in the results table. */
  selectedColumns: string[];
}

export interface TourStop {
  id: string;
  title: string;
  body: string;
  /** The action that teaches more than reading, e.g. "Apply a fix". The tour moves on by itself once it's done. */
  action?: string;
  /** CSS selectors for the part of the screen the stop highlights, best first; none found centres the popover. */
  anchors: (ctx: TourContext) => string[];
  /** Whether the action has been done since the stop began (`start` is how things were then). */
  done?: (ctx: TourContext, start: TourContext) => boolean;
  /** Get the screen ready: the results, the inspector on a node, or the inspector on the receipt of the last Fix all. */
  prepare?: 'results' | 'inspector' | 'receipt';
}

const testId = (id: string) => `[data-testid="${CSS.escape(id)}"]`;

const nodesOf = (project: Project, type: Project['nodes'][number]['type']) => project.nodes.filter((n) => n.type === type);

/** Every step in the project's Transforms; a quick fix adds one. */
export const stepCount = (project: Project) => project.nodes.reduce((n, node) => n + (node.type === 'transform' ? node.steps.length : 0), 0);

/** Every issue the project's nodes have recorded as fixed; Fix all adds to it, by a step or by a read option. */
export const fixesRecorded = (project: Project) => project.nodes.reduce((n, node) => n + (node.analysis?.issues.filter((i) => i.fixed).length ?? 0), 0);

/**
 * The stops follow what a first visit does: see what was found, fix it, read the receipt, export. Only then come
 * the canvas, the steps and the rules, for whoever wants to know how it works.
 */
export const TOUR_STOPS: TourStop[] = [
  {
    id: 'found',
    title: 'What Puddle found',
    body: 'A source is a file read right here in your browser; nothing leaves it. This one is a sample contact list. Puddle checks every file it reads, and says above the rows what it found wrong.',
    anchors: () => [testId('findings-headline'), testId('results-panel')],
    prepare: 'results',
  },
  {
    id: 'fixall',
    title: 'Fix all',
    body: 'Fix all puts right everything it can in one go. Each fix is a step you can see, change and undo; the arrow beside the button lets you choose which fixes to apply.',
    action: 'Choose Fix all to carry on.',
    anchors: () => [testId('fix-all'), testId('findings-headline'), testId('results-panel')],
    done: (now, start) => fixesRecorded(now.project) > fixesRecorded(start.project) || stepCount(now.project) > stepCount(start.project),
    prepare: 'results',
  },
  {
    id: 'receipt',
    title: 'The receipt',
    body: 'Fix all ends on a receipt: what was fixed, by which step, and how many rows each fix touched. Choose a line to open its step and see the rows as it leaves them.',
    anchors: () => [testId('fix-receipt'), testId('inspector')],
    prepare: 'receipt',
  },
  {
    id: 'export',
    title: 'Export',
    body: 'Export saves the fixed rows as CSV, Excel, JSON or Parquet. It adds an Output node, which marks data that’s ready; Save as template keeps the fixes for the next file like this one.',
    anchors: ({ project }) => [testId('receipt-foot'), ...nodesOf(project, 'output').map((n) => testId(`node-${n.name}`)), '[data-tour="add-node"]'],
    prepare: 'receipt',
  },
  {
    id: 'canvas',
    title: 'The canvas and nodes',
    body: 'Everything you do is a node on the canvas, wired left to right: sources feed steps, joins and appends, and those feed outputs. The fixes are here too, one node each. Select a node to see it in the inspector; drag to move it.',
    anchors: () => [testId('canvas')],
  },
  {
    id: 'steps',
    title: 'Steps in the inspector',
    body: 'A step’s settings are in the inspector, where you can change it, turn it off or see the data as it was there. The Add menu and each column’s menu in the results table have many more steps.',
    anchors: () => ['section[aria-label="Applied steps"]', testId('inspector')],
    prepare: 'inspector',
  },
  {
    id: 'rules',
    title: 'Rules',
    body: 'Rules check the data at a node, for example that every email is filled in. Failing rules show on the node and in the status strip, and can hold back an export.',
    anchors: () => ['section[aria-label="Rules"]', testId('inspector')],
    prepare: 'inspector',
  },
];

/** The first of these selectors that is on the page. */
export function findAnchor(selectors: string[], root: ParentNode = document): Element | null {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Side = 'below' | 'above' | 'right' | 'left' | 'centre';

/**
 * Where the popover goes: below the target if it fits, else above, right or left, clamped into the window; over a
 * target too big for any side (the whole canvas), inside its bottom edge; with no target, in the middle.
 */
export function placePopover(target: Rect | null, pop: { width: number; height: number }, view: { width: number; height: number }, gap: number): { top: number; left: number; side: Side } {
  const clamp = (v: number, max: number) => Math.max(gap, Math.min(v, max - gap));
  const centreX = (t: Rect) => clamp(t.left + t.width / 2 - pop.width / 2, view.width - pop.width);
  const centreY = (t: Rect) => clamp(t.top + t.height / 2 - pop.height / 2, view.height - pop.height);
  if (!target) return { top: clamp((view.height - pop.height) / 2, view.height - pop.height), left: clamp((view.width - pop.width) / 2, view.width - pop.width), side: 'centre' };
  const t = target;
  if (t.top + t.height + gap + pop.height + gap <= view.height) return { top: t.top + t.height + gap, left: centreX(t), side: 'below' };
  if (t.top - gap - pop.height >= gap) return { top: t.top - gap - pop.height, left: centreX(t), side: 'above' };
  if (t.left + t.width + gap + pop.width + gap <= view.width) return { top: centreY(t), left: t.left + t.width + gap, side: 'right' };
  if (t.left - gap - pop.width >= gap) return { top: centreY(t), left: t.left - gap - pop.width, side: 'left' };
  // Nothing fits outside: sit inside the target, at its bottom, still on screen.
  return { top: clamp(t.top + t.height - pop.height - gap, view.height - pop.height), left: centreX(t), side: 'centre' };
}
