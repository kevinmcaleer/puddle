import { describe, expect, it } from 'vitest';
import { addNode, createProject } from '../model';
import { nodeLabel, wireLabel } from './a11y';

const project = addNode(createProject('Labels'), 'transform', { x: 0, y: 0 });
const transform = project.nodes[0]!;

describe('what a screen reader hears on the canvas', () => {
  it('names a node with its kind, size and whether it is viewed', () => {
    const status = { state: 'ok' as const, rows: 2000, columns: [{ name: 'a', type: 'VARCHAR' }, { name: 'b', type: 'INTEGER' }] };
    expect(nodeLabel(transform, { status, viewed: true })).toBe('Transform 1, Transform, 0 steps, 2,000 rows, 2 columns, viewed');
  });

  it('reads the detail under a node’s name in place of its kind', () => {
    expect(nodeLabel({ ...transform, type: 'join' } as never, { detail: 'Join · Inner' })).toBe('Transform 1, Join, Inner');
  });

  it('says why a node can’t run', () => {
    expect(nodeLabel(transform, { status: { state: 'error', message: 'Column phone isn’t there.' } })).toBe('Transform 1, Transform, 0 steps, broken: Column phone isn’t there.');
    expect(nodeLabel(transform, { status: { state: 'blocked' } })).toMatch(/waiting on a broken node upstream$/);
    expect(nodeLabel(transform, { status: { state: 'unwired' } })).toMatch(/not connected yet$/);
    expect(nodeLabel(transform, { status: { state: 'detached' } })).toMatch(/file not connected$/);
  });

  it('names a wire by its ends, and the input it goes into when there are several', () => {
    expect(wireLabel('customers.csv', 'Transform 1')).toBe('Wire from customers.csv into Transform 1');
    expect(wireLabel('orders.csv', 'Join 1', 'Right input')).toBe('Wire from orders.csv into Join 1, right input');
  });
});
