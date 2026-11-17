import type { AddableNodeType } from '../model';
import { STEP_GROUPS, stepForms, type StepForm } from '../steps';
import type { MenuItem } from '../ui';
import { shortcutText } from './shortcuts';

/** Said under the Add menu while nothing is selected, in place of a list of entries that can't be used yet. */
export const SELECT_A_NODE_FIRST = 'Select a node to add a step or another node after it.';

/** What the Add menu holds after its sources: the items, the groups that start folded, and a line on what is not offered yet. */
export interface AfterSelection {
  items: MenuItem[];
  collapsed: string[];
  note?: string;
}

/**
 * The Add menu lists only what can be added now. Its sources and the nodes that need no input are always offered.
 * Nodes and steps go after the selected node (principle 2: nothing lands on the canvas unwired), so with nothing
 * selected they are left out, and a line says how to get them. With a node selected the steps sit folded under their
 * group headings, so the menu is short; its search finds across all of them.
 */
export function afterSelection(actions: NextActions, hasSelection: boolean): AfterSelection {
  if (!hasSelection) return { items: [], collapsed: [], note: SELECT_A_NODE_FIRST };
  const steps = stepItems(actions);
  return { items: [...nodeItems(actions), ...steps], collapsed: [...new Set(steps.map((s) => s.group!))] };
}

/** What a picked node or step does: add it after the selected node, wired from it. */
export interface NextActions {
  addNode: (type: AddableNodeType) => void;
  addStep: (form: StepForm) => void;
}

/** The nodes that can follow another, in the Add menu's order. */
export const nodeItems = ({ addNode }: NextActions): MenuItem[] => [
  { label: 'Join', icon: 'join', hint: 'Two inputs', group: 'Nodes', onSelect: () => addNode('join') },
  { label: 'Append', icon: 'append', hint: 'Stack rows', group: 'Nodes', onSelect: () => addNode('append') },
  { label: 'Lookup', icon: 'join', hint: 'Bring columns across', group: 'Nodes', onSelect: () => addNode('lookup') },
  { label: 'Query', icon: 'query', hint: 'Design with tables', group: 'Nodes', onSelect: () => addNode('query') },
  { label: 'SQL', icon: 'code', hint: 'Write a query', group: 'Nodes', onSelect: () => addNode('sql') },
  { label: 'Output', icon: 'output', shortcut: shortcutText('add-output'), group: 'Nodes', onSelect: () => addNode('output') },
];

const stepItem = (f: StepForm, { addStep }: NextActions, group?: string): MenuItem => ({ label: f.title, group, hint: f.newColumn ? 'New column' : undefined, onSelect: () => addStep(f) });

/** Every step, each making a node of its own after the selected node, under its group's heading ("Clean steps"). */
export const stepItems = (actions: NextActions): MenuItem[] => STEP_GROUPS.flatMap((g) => stepForms().filter((f) => f.group === g).map((f) => stepItem(f, actions, `${g} steps`)));

/**
 * The menu a click on a node's output connector opens: the same nodes and steps as the Add menu, for that node (one
 * model, many doors). The steps sit in a submenu per group, as in the column menu, so the menu fits beside the node;
 * the last item opens the Add menu's search for the step whose group isn't obvious.
 */
export const connectorItems = (actions: NextActions & { searchSteps: () => void }): MenuItem[] => [
  ...nodeItems(actions),
  ...STEP_GROUPS.map((g) => ({ label: g, group: 'Steps', onSelect: () => undefined, items: stepForms().filter((f) => f.group === g).map((f) => stepItem(f, actions)) })).filter((m) => m.items.length),
  { label: 'Search steps', icon: 'search', group: 'Steps', shortcut: shortcutText('add-transform'), onSelect: actions.searchSteps },
];
