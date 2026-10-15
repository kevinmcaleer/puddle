import fc from 'fast-check';
import { flow, src } from '../../tests/helpers/projects';
import { canConnect, connect, downstreamIds, GraphError, removeNode, topoSort, upstreamIds } from './graph';
import { parseProject } from './project';
import type { Project } from './schema';

const chain = () =>
  flow({
    sources: [src({ id: 'a', format: 'csv' })],
    nodes: [
      { id: 's', type: 'source', sourceId: 'a' },
      { id: 't1', type: 'transform' },
      { id: 't2', type: 'transform' },
      { id: 'o', type: 'output' },
    ],
    wires: [['s', 't1'], ['t1', 't2'], ['t2', 'o']],
  });

const edge = (from: string, to: string) => ({ id: `x_${from}_${to}`, from: { nodeId: from }, to: { nodeId: to, port: 0 } });

describe('connections', () => {
  it('refuses each invalid wire with a reason', () => {
    const p = chain();
    const extra = { ...p, nodes: [...p.nodes, { id: 't3', type: 'transform' as const, name: 'Spare', position: { x: 0, y: 0 }, rules: [], steps: [] }] };
    expect(canConnect(extra, 't1', 't1')).toEqual({ ok: false, reason: "A node can't feed into itself." });
    expect(canConnect(extra, 'o', 't3')).toMatchObject({ ok: false, reason: expect.stringContaining('Output node') });
    expect(canConnect(extra, 't3', 's')).toMatchObject({ ok: false, reason: expect.stringContaining('Source node') });
    expect(canConnect(extra, 't3', 't2')).toMatchObject({ ok: false, reason: expect.stringContaining('already has an input') });
    expect(canConnect(extra, 't1', 't2')).toMatchObject({ ok: false, reason: 'These nodes are already connected.' });
    expect(canConnect(extra, 't2', 't3')).toEqual({ ok: true });
    expect(canConnect(extra, 'nope', 't3')).toMatchObject({ ok: false });
  });

  it('refuses a wire that would create a cycle', () => {
    const p = disconnectInput(chain(), 't1');
    expect(canConnect(p, 't2', 't1')).toMatchObject({ ok: false, reason: expect.stringContaining('loop') });
    expect(() => connect(p, edge('t2', 't1'))).toThrow(GraphError);
  });

  it('walks upstream and downstream', () => {
    const p = chain();
    expect([...upstreamIds(p, 't2')].sort()).toEqual(['s', 't1', 't2']);
    expect([...downstreamIds(p, 't1')].sort()).toEqual(['o', 't1', 't2']);
    expect(topoSort(p)).toEqual(['s', 't1', 't2', 'o']);
  });

  it('removes a node with its wires', () => {
    const p = removeNode(chain(), 't1');
    expect(p.nodes.map((n) => n.id)).toEqual(['s', 't2', 'o']);
    expect(p.edges.map((e) => [e.from.nodeId, e.to.nodeId])).toEqual([['t2', 'o']]);
  });
});

function disconnectInput(p: Project, nodeId: string): Project {
  return { ...p, edges: p.edges.filter((e) => e.to.nodeId !== nodeId) };
}

/** Random acyclic flows: edges only go from a lower index to a higher one, at most one input per node. */
const arbFlow = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc.tuple(
      fc.constant(n),
      fc.array(fc.integer({ min: 0, max: n - 1 }), { minLength: n, maxLength: n }),
      fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      fc.array(fc.constantFrom('csv', 'tsv', 'json', 'ndjson', 'parquet') as fc.Arbitrary<'csv'>, { minLength: n, maxLength: n }),
    ),
  )
  .map(([n, parents, wired, formats]) => {
    const nodes = Array.from({ length: n }, (_, i) =>
      i === 0 ? ({ id: 'n0', type: 'source' as const, sourceId: 'src0' }) : ({ id: `n${i}`, type: 'transform' as const, steps: [] }),
    );
    const wires: Array<[string, string]> = [];
    for (let i = 1; i < n; i++) if (wired[i]) wires.push([`n${parents[i]! % i}`, `n${i}`]);
    return flow({ sources: [src({ id: 'src0', format: formats[0]! })], nodes, wires });
  });

describe('properties', () => {
  it('round-trips random flows through JSON serialisation', () => {
    fc.assert(
      fc.property(arbFlow, (p) => {
        expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
      }),
    );
  });

  it('never accepts a wire that closes a loop', () => {
    fc.assert(
      fc.property(arbFlow, fc.nat(), fc.nat(), (p, a, b) => {
        const ids = p.nodes.map((n) => n.id);
        const from = ids[a % ids.length]!;
        const to = ids[b % ids.length]!;
        const check = canConnect(p, from, to);
        if (upstreamIds(p, from).has(to)) expect(check.ok).toBe(false);
        if (check.ok) expect(() => topoSort(connect(p, edge(from, to)))).not.toThrow();
      }),
    );
  });

  it('stays acyclic under any sequence of attempted wires', () => {
    fc.assert(
      fc.property(arbFlow, fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 30 }), (start, attempts) => {
        let p = start;
        const ids = p.nodes.map((n) => n.id);
        for (const [a, b] of attempts) {
          try {
            p = connect(p, edge(ids[a % ids.length]!, ids[b % ids.length]!));
          } catch (e) {
            expect(e).toBeInstanceOf(GraphError);
          }
        }
        expect(topoSort(p)).toHaveLength(ids.length);
      }),
    );
  });
});
