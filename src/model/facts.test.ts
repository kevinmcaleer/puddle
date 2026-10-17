import { carryFacts } from './facts';
import { createProject } from './project';
import type { Project, Source } from './schema';

const file = (headHash: string) => ({ originalName: `${headHash}.csv`, size: 1, lastModified: 0, headHash });
const source = (s: Partial<Source> & Pick<Source, 'id'>): Source => ({ name: s.id, kind: 'file', format: 'csv', parseOptions: {}, detectedSchema: [], ...s });
const project = (sources: Source[]): Project => ({ ...createProject('Facts'), sources });

describe('carrying source facts through undo', () => {
  it('takes each source’s file and fetched address facts from the newer version', () => {
    const to = project([source({ id: 'a', file: file('old') }), source({ id: 'u', kind: 'url', url: { href: 'https://x/a.csv', headHash: 'h1', size: 1 } })]);
    const from = project([source({ id: 'a', file: file('new') }), source({ id: 'u', kind: 'url', url: { href: 'https://x/a.csv', headHash: 'h2', size: 2 } })]);
    const carried = carryFacts(to, from);
    expect(carried.sources[0]!.file?.headHash).toBe('new');
    expect(carried.sources[1]!.url).toMatchObject({ href: 'https://x/a.csv', headHash: 'h2', size: 2 });
  });

  it('leaves what undo restores alone: other addresses, read options, detected columns, sources only one side has', () => {
    const to = project([
      source({ id: 'u', kind: 'url', url: { href: 'https://x/old.csv', headHash: 'h1' } }),
      source({ id: 'p', parseOptions: { header: true }, detectedSchema: [{ name: 'a', type: 'VARCHAR' }] }),
      source({ id: 'gone-later' }),
    ]);
    const from = project([
      source({ id: 'u', kind: 'url', url: { href: 'https://x/new.csv', headHash: 'h2' } }),
      source({ id: 'p', parseOptions: { header: false }, detectedSchema: [{ name: 'column0', type: 'VARCHAR' }] }),
      source({ id: 'added-later', file: file('x') }),
    ]);
    expect(carryFacts(to, from)).toBe(to);
  });

  it('returns the same project when nothing differs', () => {
    const p = project([source({ id: 'a', file: file('same') })]);
    expect(carryFacts(p, p)).toBe(p);
    expect(carryFacts(p, { ...p, sources: [...p.sources] })).toBe(p);
  });
});
