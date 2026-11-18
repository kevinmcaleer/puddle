import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { recordAnalysis, removeStep, toggleStep } from '../model';
import { fixedCount, fixReceipt, receiptNodeOf, receiptTemplate, receiptTitle, touched } from './receipt';

const found = [
  { key: 'bannerRows', kind: 'bannerRows', label: 'Lines above the table', count: 2 },
  { key: 'duplicateRows', kind: 'duplicateRows', label: 'Duplicate rows', count: 1 },
  { key: 'edgeSpaces:name', kind: 'edgeSpaces', column: 'name', label: 'Spaces at either end of name', count: 2 },
  { key: 'edgeSpaces:city', kind: 'edgeSpaces', column: 'city', label: 'Spaces at either end of city', count: 1 },
  { key: 'mixedCase:city', kind: 'mixedCase', column: 'city', label: 'Mixed capitals in city', count: 3 },
  { key: 'datesAsText:joined', kind: 'datesAsText', column: 'joined', label: 'Dates stored as text in joined', count: 5 },
];

// A source, the two Transforms Fix all added after it (trim, then dedupe and a step of the user's own), and an Output.
const base = flow({
  sources: [src({ id: 'people', format: 'csv' })],
  nodes: [
    { id: 's', type: 'source', sourceId: 'people' },
    { id: 'a', type: 'transform', steps: [step('trim', 'trimWhitespace', { columns: ['name', 'city'] })] },
    { id: 'b', type: 'transform', steps: [step('mine', 'removeColumns', { columns: ['notes'] }), step('dedupe', 'duplicateRows', {})] },
    { id: 'out', type: 'output' },
  ],
  wires: [['s', 'a'], ['a', 'b'], ['b', 'out']],
});
const AT = '2026-11-17T09:00:00.000Z';
const fixed = recordAnalysis(
  base,
  's',
  found,
  ['bannerRows', 'duplicateRows', 'edgeSpaces:name', 'edgeSpaces:city'],
  AT,
  12,
  { duplicateRows: ['dedupe'], 'edgeSpaces:name': ['trim'], 'edgeSpaces:city': ['trim'] },
  ['bannerRows'],
);

describe('the Fix all receipt', () => {
  it('has a line for the read options, then one per step in the order they run, each with its issues and what they touched', () => {
    const r = fixReceipt(fixed, 's')!;
    expect(r).toMatchObject({ nodeId: 's', at: AT, rows: 12, fixed: 4, lastNodeId: 'b' });
    expect(receiptTitle(r)).toBe('Fixed 4 issues');
    expect(r.lines.map((l) => [l.key, l.nodeId, l.stepIndex, l.issues.map((i) => `${i.label}: ${i.touched}`)])).toEqual([
      ['read', 's', undefined, ['Lines above the table: 2 rows']],
      ['trim', 'a', 0, ['Spaces at either end of name: 2 rows', 'Spaces at either end of city: 1 row']],
      ['dedupe', 'b', 1, ['Duplicate rows: 1 row']],
    ]);
    expect(r.lines[0]!.label).toBe('Read options');
    expect(r.lines[1]!.label).toBe(step('trim', 'trimWhitespace', { columns: ['name', 'city'] }).label);
  });

  it('leaves out the issues that weren’t fixed, and a step the user added', () => {
    const keys = fixReceipt(fixed, 's')!.lines.flatMap((l) => l.issues.map((i) => i.key));
    expect(keys).not.toContain('mixedCase:city');
    expect(keys).not.toContain('datesAsText:joined');
    expect(fixReceipt(fixed, 's')!.lines.some((l) => l.stepId === 'mine')).toBe(false);
  });

  it('drops the line of a deleted step and marks one turned off', () => {
    const removed = fixReceipt(removeStep(fixed, 'b', 'dedupe'), 's')!;
    expect(removed.lines.map((l) => l.key)).toEqual(['read', 'trim']);
    expect(removed).toMatchObject({ fixed: 3, lastNodeId: 'a' });
    const off = fixReceipt(toggleStep(fixed, 'a', 'trim'), 's')!;
    expect(off.lines.map((l) => l.off)).toEqual([false, true, false]);
  });

  it('lists an issue fixed by several steps under each of them, counted once', () => {
    const both = recordAnalysis(base, 's', found, ['edgeSpaces:name'], AT, 12, { 'edgeSpaces:name': ['trim', 'dedupe'] });
    const r = fixReceipt(both, 's')!;
    expect(r.lines.map((l) => l.issues.map((i) => i.key))).toEqual([['edgeSpaces:name'], ['edgeSpaces:name']]);
    expect(r.fixed).toBe(1);
    expect(receiptTitle(r)).toBe('Fixed 1 issue');
  });

  it('counts for the badge what the receipt counts: the issues fixed by read options as well as by steps', () => {
    expect(fixedCount(fixed, 's')).toBe(4);
    expect(fixedCount(fixed, 's')).toBe(fixReceipt(fixed, 's')!.fixed);
    const read = recordAnalysis(base, 's', found, ['bannerRows'], AT, 12, {}, ['bannerRows']);
    expect(fixedCount(read, 's')).toBe(1);
    // A fix whose step is turned off or deleted is open again, so it leaves the count.
    expect(fixedCount(toggleStep(fixed, 'a', 'trim'), 's')).toBe(2);
    expect(fixedCount(removeStep(fixed, 'b', 'dedupe'), 's')).toBe(3);
    expect(fixedCount(base, 's')).toBe(0);
    expect(fixedCount(base, 'nope')).toBe(0);
  });

  it('starts a template from the steps Fix all added, in order, named after the file', () => {
    const named = { ...fixed, nodes: fixed.nodes.map((n) => (n.id === 's' ? { ...n, name: 'people 2026.csv' } : n)) };
    expect(receiptTemplate(fixReceipt(named, 's')!)).toEqual({ name: 'people 2026 fixes', nodeIds: ['a', 'b'], stepIds: ['trim', 'dedupe'] });
    // The user's own step in the same node isn't one of the fixes, and read options are not steps.
    const read = recordAnalysis(base, 's', found, ['bannerRows'], AT, 12, {}, ['bannerRows']);
    expect(receiptTemplate(fixReceipt(read, 's')!)).toBeUndefined();
  });

  it('ends on the node itself when only read options changed', () => {
    const read = recordAnalysis(base, 's', found, ['bannerRows'], AT, 12, {}, ['bannerRows']);
    expect(fixReceipt(read, 's')).toMatchObject({ fixed: 1, lastNodeId: 's' });
  });

  it('is nothing for a node with no analysis kept, nothing fixed, or every fixing step gone', () => {
    expect(fixReceipt(base, 's')).toBeUndefined();
    expect(fixReceipt(base, 'nope')).toBeUndefined();
    expect(fixReceipt(recordAnalysis(base, 's', found, [], AT, 12), 's')).toBeUndefined();
    const steps = recordAnalysis(base, 's', found, ['duplicateRows'], AT, 12, { duplicateRows: ['dedupe'] });
    expect(fixReceipt(removeStep(steps, 'b', 'dedupe'), 's')).toBeUndefined();
  });

  it('counts mixed capitals in values, as the Issues panel does, and everything else in rows', () => {
    expect(touched({ kind: 'mixedCase', count: 3 })).toBe('3 values');
    expect(touched({ kind: 'mixedCase', count: 1 })).toBe('1 value');
    expect(touched({ kind: 'edgeSpaces', count: 1200 })).toBe('1,200 rows');
  });
});

describe('the node a group’s fixes belong to', () => {
  it('is the node whose Fix all added a step in the group', () => {
    expect(receiptNodeOf(fixed, ['a', 'b'])).toBe('s');
    expect(receiptNodeOf(fixed, ['b'])).toBe('s');
  });

  it('is none for nodes holding no fixing step', () => {
    expect(receiptNodeOf(fixed, ['s', 'out'])).toBeUndefined();
    expect(receiptNodeOf(base, ['a', 'b'])).toBeUndefined();
    expect(receiptNodeOf(removeStep(fixed, 'a', 'trim'), ['a'])).toBeUndefined();
  });
});
