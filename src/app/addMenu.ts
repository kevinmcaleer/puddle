import type { MenuItem } from '../ui';

/** The hint on the Add menu's nodes and steps while nothing is selected. */
export const SELECT_A_NODE_FIRST = 'Select a node first';

/**
 * The Add menu's nodes and steps, which go after the selected node: with nothing selected they are shown but
 * disabled, saying why, so nothing lands on the canvas unwired (principle 2: data runs left to right).
 */
export function afterSelection(items: MenuItem[], hasSelection: boolean): MenuItem[] {
  return hasSelection ? items : items.map((item) => ({ ...item, disabled: true, hint: SELECT_A_NODE_FIRST }));
}
