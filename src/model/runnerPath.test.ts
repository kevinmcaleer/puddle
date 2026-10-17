import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { setRunnerPath } from './edits';

describe('the runner path on a file source', () => {
  it('is set on the file, cleared by an empty value, and never put on a source without a file', () => {
    const file = { originalName: 'customers.csv', size: 1, lastModified: 0, headHash: 'h' };
    const a = { ...src({ id: 'a', format: 'csv' }), file };
    const c = { ...src({ id: 'c', format: 'csv' }), kind: 'clipboard' as const, clipboard: { text: 'x' } };
    const p = flow({ sources: [a, c], nodes: [], wires: [] });
    const set = setRunnerPath(p, 'a', 'sources/customers.csv');
    expect(set.sources[0]!.file?.path).toBe('sources/customers.csv');
    expect(setRunnerPath(set, 'a', '').sources[0]!.file).toEqual(file);
    expect(setRunnerPath(p, 'c', '/x').sources[1]).toEqual(c);
  });
});
