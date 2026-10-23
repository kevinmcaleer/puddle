import type { AddableNodeType } from '../model';
import { STEP_GROUPS, stepForms, type StepForm } from '../steps';
import type { MenuItem } from '../ui';
import { shortcutText } from './shortcuts';

/** The hint on the Add menu's nodes and steps while nothing is selected. */
export const SELECT_A_NODE_FIRST = 'Select a node first';

/**
 * The Add menu's nodes and steps, which go after the selected node: with nothing selected they are shown but
 * disabled, saying why, so nothing lands on the canvas unwired (principle 2: data runs left to right).
 */
export function afterSelection(items: MenuItem[], hasSelection: boolean): MenuItem[] {
  return hasSelection ? items : items.map((item) => ({ ...item, disabled: true, hint: SELECT_A_NODE_FIRST }));
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
