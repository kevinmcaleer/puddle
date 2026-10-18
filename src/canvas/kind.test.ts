import { describe, expect, it } from 'vitest';
import { step } from '../../tests/helpers/projects';
import type { GraphNode, Step } from '../model';
import { cardHeading, cardKind } from './kind';

const transform = (steps: Step[]): GraphNode => ({ id: 't', type: 'transform', name: 'Transform 1', position: { x: 0, y: 0 }, rules: [], steps });

describe('cardKind', () => {
  it('draws a Lookup as a Join and every other node as itself', () => {
    expect(cardKind('lookup')).toBe('join');
    expect(cardKind('transform')).toBe('transform');
  });
});

describe('cardHeading', () => {
  it('heads a one-step Transform by what the step does, with the node name under it', () => {
    const one = transform([{ ...step('a', 'trimWhitespace', { columns: ['name'] }), label: 'Trimmed name' }]);
    expect(cardHeading(one)).toEqual({ name: 'Trimmed name', detail: 'Transform 1' });
    // A detail given (such as a group's) still wins over the node name.
    expect(cardHeading(one, 'In Group 1')).toEqual({ name: 'Trimmed name', detail: 'In Group 1' });
  });

  it('heads an empty or stacked Transform, and any other node, by its name', () => {
    expect(cardHeading(transform([]))).toEqual({ name: 'Transform 1', detail: undefined });
    const two = transform([step('a', 'trimWhitespace', { columns: ['name'] }), step('b', 'removeColumns', { columns: ['email'] })]);
    expect(cardHeading(two)).toEqual({ name: 'Transform 1', detail: undefined });
    const out: GraphNode = { id: 'o', type: 'output', name: 'Output 1', position: { x: 0, y: 0 }, rules: [], outputSpec: { format: 'csv', options: {} } };
    expect(cardHeading(out, 'CSV')).toEqual({ name: 'Output 1', detail: 'CSV' });
  });
});
