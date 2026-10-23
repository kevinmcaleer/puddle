import { describe, expect, it } from 'vitest';
import { STEP_GROUPS, stepForms } from '../steps';
import { afterSelection, connectorItems, nodeItems, SELECT_A_NODE_FIRST, stepItems } from './addMenu';

const items = [
  { label: 'Output', hint: undefined, onSelect: () => undefined },
  { label: 'Join', hint: 'Two inputs', onSelect: () => undefined },
];

describe('the Add menu’s nodes and steps (principle 2: never an unwired node)', () => {
  it('are offered as they are once a node is selected', () => {
    expect(afterSelection(items, true)).toBe(items);
  });

  it('wait, saying why, while nothing is selected', () => {
    expect(afterSelection(items, false).map((i) => [i.label, i.disabled, i.hint])).toEqual([
      ['Output', true, SELECT_A_NODE_FIRST],
      ['Join', true, SELECT_A_NODE_FIRST],
    ]);
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
