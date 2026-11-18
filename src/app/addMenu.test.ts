import { describe, expect, it } from 'vitest';
import { STEP_GROUPS, stepForms } from '../steps';
import { afterSelection, connectorItems, nodeItems, SELECT_A_NODE_FIRST, stepItems } from './addMenu';

describe('the Add menu lists only what can be added now (principle 2: never an unwired node)', () => {
  const picked: string[] = [];
  const actions = { addNode: (t: string) => picked.push(`node:${t}`), addStep: (f: { type: string }) => picked.push(`step:${f.type}`) };

  it('offers no node or step while nothing is selected, and says how to get them', () => {
    const menu = afterSelection(actions, false);
    expect(menu.items).toEqual([]);
    expect(menu.collapsed).toEqual([]);
    expect(menu.note).toBe(SELECT_A_NODE_FIRST);
  });

  it('offers every node and step once a node is selected, none of them disabled', () => {
    const menu = afterSelection(actions, true);
    expect(menu.note).toBeUndefined();
    expect(menu.items.filter((i) => i.group === 'Nodes').map((i) => i.label)).toEqual(['Join', 'Append', 'Lookup', 'Query', 'SQL', 'Output']);
    expect(menu.items.filter((i) => i.group !== 'Nodes').length).toBe(stepForms().length);
    expect(menu.items.some((i) => i.disabled)).toBe(false);
  });

  it('folds the steps under their group headings, and leaves the nodes open', () => {
    const menu = afterSelection(actions, true);
    expect(menu.collapsed).toEqual(STEP_GROUPS.filter((g) => stepForms().some((f) => f.group === g)).map((g) => `${g} steps`));
    expect(menu.collapsed).not.toContain('Nodes');
    // Every step is in a folded group, so the open menu is its nodes and one heading per group.
    for (const step of menu.items.filter((i) => i.group !== 'Nodes')) expect(menu.collapsed).toContain(step.group);
  });

  it('adds what is picked after the selected node', () => {
    picked.length = 0;
    const menu = afterSelection(actions, true);
    menu.items.find((i) => i.label === 'Output')!.onSelect();
    menu.items.find((i) => i.label === 'Trim whitespace')!.onSelect();
    expect(picked).toEqual(['node:output', 'step:trimWhitespace']);
  });
});

describe('the connector menu (a click on a node’s output)', () => {
  const picked: string[] = [];
  const actions = { addNode: (t: string) => picked.push(`node:${t}`), addStep: (f: { type: string }) => picked.push(`step:${f.type}`), searchSteps: () => picked.push('search') };
  const connector = connectorItems(actions);
  const toolbar = [...nodeItems(actions), ...stepItems(actions)];

  it('offers the Add menu’s nodes, in its order', () => {
    expect(connector.filter((i) => i.group === 'Nodes').map((i) => i.label)).toEqual(['Join', 'Append', 'Lookup', 'Query', 'SQL', 'Output']);
  });

  it('holds every step of the Add menu, each in a submenu named after its group (one grouping, one model)', () => {
    expect(stepForms().length).toBeGreaterThan(20);
    const submenus = connector.filter((i) => i.items);
    expect(submenus.map((m) => m.label)).toEqual(STEP_GROUPS.filter((g) => stepForms().some((f) => f.group === g)));
    for (const m of submenus) expect(m.items!.map((s) => s.label)).toEqual(toolbar.filter((t) => t.group === `${m.label} steps`).map((t) => t.label));
    expect(submenus.flatMap((m) => m.items!).length).toBe(stepForms().length);
  });

  it('adds what is picked through the same actions as the Add menu', () => {
    picked.length = 0;
    connector.find((i) => i.label === 'Output')!.onSelect();
    connector.find((i) => i.label === 'Clean')!.items!.find((s) => s.label === 'Trim whitespace')!.onSelect();
    connector.find((i) => i.label === 'Search steps')!.onSelect();
    expect(picked).toEqual(['node:output', 'step:trimWhitespace', 'search']);
  });
});
