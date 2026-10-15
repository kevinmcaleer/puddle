import { flow } from '../../tests/helpers/projects';
import type { Project, Rule } from '../model';
import { describeBlock, exportGate } from './gate';

const rule = (id: string, severity: 'fail' | 'warn' = 'fail', enabled = true): Rule => ({ id, type: 'notEmpty', label: `rule ${id}`, enabled, severity, params: { column: 'a' } });

// in → mid → out, plus a side branch that doesn't feed out.
function project(rules: Record<string, Rule[]>): Project {
  const p = flow({
    nodes: [
      { id: 'in', type: 'transform' },
      { id: 'mid', type: 'transform' },
      { id: 'out', type: 'output' },
      { id: 'side', type: 'transform' },
    ],
    wires: [['in', 'mid'], ['mid', 'out'], ['in', 'side']],
  });
  return { ...p, nodes: p.nodes.map((n) => ({ ...n, rules: rules[n.id] ?? [] })) };
}
const ok = (failures: number) => ({ state: 'ok' as const, failures, total: 10 });

describe('exportGate', () => {
  it('blocks on failing fail rules upstream, nearest the source first', () => {
    const p = project({ mid: [rule('m')], in: [rule('i')] });
    expect(exportGate(p, 'out', { in: { results: { i: ok(1) } }, mid: { results: { m: ok(3) } } })).toEqual({
      state: 'blocked',
      blocking: [
        { nodeId: 'in', nodeName: 'in', ruleId: 'i', label: 'rule i', failures: 1 },
        { nodeId: 'mid', nodeName: 'mid', ruleId: 'm', label: 'rule m', failures: 3 },
      ],
    });
  });

  it('ignores warnings, disabled rules and branches that don’t feed the output', () => {
    const p = project({ in: [rule('w', 'warn'), rule('off', 'fail', false)], side: [rule('s')] });
    expect(exportGate(p, 'out', { in: { results: { w: ok(5), off: ok(5) } }, side: { results: { s: ok(5) } } })).toEqual({ state: 'clear' });
  });

  it('waits for rules still being checked, but a known failure already blocks', () => {
    const p = project({ in: [rule('i')], mid: [rule('m')] });
    expect(exportGate(p, 'out', { in: { results: { i: ok(0) } } })).toEqual({ state: 'checking' });
    expect(exportGate(p, 'out', { in: { results: { i: ok(2) } } })).toMatchObject({ state: 'blocked' });
  });

  it('blocks on a rule that can’t run', () => {
    const p = project({ mid: [rule('m')] });
    const gate = exportGate(p, 'out', { mid: { results: { m: { state: 'error', message: 'No column a.' } } } });
    expect(gate).toMatchObject({ state: 'blocked', blocking: [{ error: 'No column a.' }] });
  });
});

describe('describeBlock', () => {
  it('names the rule, the rows and the node', () => {
    expect(describeBlock({ nodeId: 'n', nodeName: 'Clean', ruleId: 'r', label: 'id is unique', failures: 1 })).toBe('id is unique fails on 1 row in Clean.');
    expect(describeBlock({ nodeId: 'n', nodeName: 'Clean', ruleId: 'r', label: 'id is unique', failures: 2 })).toBe('id is unique fails on 2 rows in Clean.');
    expect(describeBlock({ nodeId: 'n', nodeName: 'Clean', ruleId: 'r', label: 'x', error: 'Broken.' })).toBe('x in Clean can’t run: Broken.');
  });
});
