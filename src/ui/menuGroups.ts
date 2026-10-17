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
