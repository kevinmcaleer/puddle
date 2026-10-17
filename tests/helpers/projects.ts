import { createProject, parseProject, type AppendSpec, type JoinSpec, type LookupSpec, type QuerySpec, type SqlSpec, type Port, type Project, type Source, type Step } from '../../src/model';

type SourceInit = Pick<Source, 'id' | 'format'> & Partial<Source>;

export const src = (s: SourceInit): Source => ({ name: s.id, kind: 'file', parseOptions: {}, detectedSchema: [], ...s });

export const step = (id: string, type: string, params: Record<string, unknown>, enabled = true): Step => ({ id, type, label: `${type} ${id}`, enabled, params });

interface FlowInit {
  sources?: Source[];
  nodes: Array<
    | { id: string; type: 'source'; sourceId: string }
    | { id: string; type: 'transform'; steps?: Step[] }
    | { id: string; type: 'join'; joinSpec?: Partial<JoinSpec> }
    | { id: string; type: 'append'; appendSpec?: Partial<AppendSpec> }
    | { id: string; type: 'lookup'; lookupSpec?: Partial<LookupSpec> }
    | { id: string; type: 'query'; querySpec?: Partial<QuerySpec> }
    | { id: string; type: 'sql'; sqlSpec?: Partial<SqlSpec> }
    | { id: string; type: 'output' }
  >;
  /** A wire goes into input 0 unless it names a port ("left", "right"). */
  wires?: Array<[from: string, to: string, port?: Port]>;
}

/** Build a valid project from a compact description. */
export function flow({ sources = [], nodes, wires = [] }: FlowInit): Project {
  const base = createProject('Test', new Date('2026-01-01T00:00:00Z'));
  return parseProject({
    ...base,
    id: 'p1',
    sources,
    nodes: nodes.map((n) => ({ name: n.id, ...n })),
    edges: wires.map(([from, to, port = 0], i) => ({ id: `e${i}`, from: { nodeId: from }, to: { nodeId: to, port } })),
  });
}
