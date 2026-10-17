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
  /** Get the screen ready, e.g. show the inspector the stop points at. */
  prepare?: 'results' | 'inspector';
}

const testId = (id: string) => `[data-testid="${CSS.escape(id)}"]`;

const nodesOf = (project: Project, type: Project['nodes'][number]['type']) => project.nodes.filter((n) => n.type === type);

/** Every step in the project's Transforms; a quick fix adds one. */
export const stepCount = (project: Project) => project.nodes.reduce((n, node) => n + (node.type === 'transform' ? node.steps.length : 0), 0);

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'sources',
    title: 'Sources',
    body: 'A source is a file read into DuckDB right here in your browser. This one is a sample contact list; Add brings in your own CSV, Excel, JSON or Parquet files. Nothing leaves your browser.',
    anchors: ({ project }) => nodesOf(project, 'source').map((n) => testId(`node-${n.name}`)),
  },
  {
    id: 'canvas',
    title: 'The canvas and nodes',
    body: 'Nodes wire together into a flow, left to right: sources feed transforms, joins and appends, and those feed outputs. Select a node to see it in the inspector; drag to move it.',
    anchors: () => [testId('canvas')],
  },
  {
    id: 'results',
    title: 'The results table',
    body: 'The table shows the data at the node you’re viewing. Each header shows the column’s type and a bar for missing and unusual values.',
    action: 'Select a column header to carry on.',
    anchors: () => [testId('results-table')],
    done: (now, start) => now.selectedColumns.length > 0 && now.selectedColumns.join('\n') !== start.selectedColumns.join('\n'),
    prepare: 'results',
  },
  {
    id: 'quickfix',
    title: 'Quick fixes',
    body: 'With columns selected, the quick-fix bar adds a cleaning step in one click, where the data you’re viewing is.',
    action: 'Apply a fix, for example Trim.',
    anchors: () => [testId('quick-fixes'), testId('results-table')],
    done: (now, start) => stepCount(now.project) > stepCount(start.project),
    prepare: 'results',
  },
  {
    id: 'steps',
    title: 'Steps in the inspector',
    body: 'Every fix is a step, listed in order in the inspector. Select a step to change its settings or see the data as it was there; Add step has many more.',
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
  {
    id: 'output',
    title: 'The Output node',
    body: 'An Output node marks data that’s ready. Add one from the Add menu, then export it as CSV, Excel, JSON or Parquet from the results bar.',
    anchors: ({ project }) => [...nodesOf(project, 'output').map((n) => testId(`node-${n.name}`)), '[data-tour="add-node"]'],
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
