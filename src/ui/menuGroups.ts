import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MenuItem } from './Menu';

/** The items in the order given, gathered under their group headings; ungrouped items first. */
export function groupItems(items: MenuItem[]): { group?: string; items: MenuItem[] }[] {
  const groups: { group?: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return groups;
}

/**
 * The arrow keys, Home and End move focus between a menu's own items (not those of a submenu open inside it). Put it
 * on the element with role="menu".
 */
export function moveMenuFocus(e: ReactKeyboardEvent<HTMLElement>) {
  // The handler sits on the menu itself, or on a popover that holds a search field above the menu.
  const root = e.currentTarget.getAttribute('role') === 'menu' ? e.currentTarget : e.currentTarget.querySelector<HTMLElement>('[role="menu"]');
  if (!root) return;
  const list = [...root.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')].filter((b) => b.closest('[role="menu"]') === root);
  const at = list.indexOf(document.activeElement as HTMLButtonElement);
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
  if (next == null || !list.length) return;
  e.preventDefault();
  list[(next + list.length) % list.length]!.focus();
}
