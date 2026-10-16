import { create } from 'zustand';
import { compile, CompileError, compileCount, SchemaCache, upstreamKey } from '../compiler';
import { tableRows, toEngineError, type EngineClient } from '../engine';
import { inputEdges, topoSort, type ColumnSchema, type Project } from '../model';

/**
 * What the canvas knows about each node's output:
 * - ok: it compiles and DuckDB can describe it (rows arrive later from a background count);
 * - unwired: it has no input yet, which isn't an error;
 * - error: this node is where the flow breaks (bad step, missing column, unreadable file);
 * - blocked: something upstream is broken, so this node dims;
 * - detached: a source whose file needs choosing again after the project was reopened.
 */
export type NodeStatus =
  | { state: 'pending' }
  | { state: 'detached' }
  | { state: 'ok'; columns: ColumnSchema[]; rows?: number }
  | { state: 'unwired' }
  | { state: 'error'; message: string; /** Stop was pressed before it finished; Run again retries. */ stopped?: boolean }
  | { state: 'blocked' };

interface Entry {
  key: string;
  status: NodeStatus;
}

interface FlowState {
  nodes: Record<string, Entry>;
}

export const useFlowStore = create<FlowState>(() => ({ nodes: {} }));

const PENDING: NodeStatus = { state: 'pending' };

// The fallback is a constant: a fresh object per call would make the selector loop forever.
export const useNodeStatus = (nodeId: string): NodeStatus => useFlowStore((s) => s.nodes[nodeId]?.status ?? PENDING);

let schemaCache: SchemaCache | null = null;
let cacheEngine: EngineClient | null = null;
const counts = new Map<string, Promise<number>>();

export function schemaCacheFor(engine: EngineClient): SchemaCache {
  if (cacheEngine !== engine) {
    cacheEngine = engine;
    schemaCache = new SchemaCache((sql) => engine.describe(sql));
    counts.clear();
  }
  return schemaCache!;
}

/** Full row count for a node (or one of its steps, or its rows failing a rule), cached by its upstream key and run at background priority. */
export function countRows(engine: EngineClient, project: Project, nodeId: string, stepIndex?: number, failingRuleId?: string): Promise<number> {
  const target = { nodeId, stepIndex, failingRuleId };
  const key = upstreamKey(project, target);
  let hit = counts.get(key);
  if (!hit) {
    hit = engine.query(compileCount(project, target), { priority: 'background', label: 'Counting rows' }).then((r) => Number(tableRows(r.table)[0]!.n));
    counts.set(key, hit);
    hit.catch(() => counts.delete(key));
  }
  return hit;
}

/** Forget cached schemas and counts, e.g. after a source file is re-registered. */
export function invalidateCaches() {
  schemaCache?.clear();
  counts.clear();
  useFlowStore.setState({ nodes: {} });
}

let generation = 0;

/** Re-evaluate every node whose upstream changed. Nodes whose key is unchanged keep their status. */
export async function evaluateFlow(engine: EngineClient, project: Project, isDetached: (sourceId: string) => boolean = () => false): Promise<void> {
  const gen = ++generation;
  const cache = schemaCacheFor(engine);
  let order: string[];
  try {
    order = topoSort(project);
  } catch {
    return;
  }
  const prev = useFlowStore.getState().nodes;
  const next: Record<string, Entry> = {};
  const publish = () => gen === generation && useFlowStore.setState({ nodes: { ...next } });

  for (const id of order) {
    const key = upstreamKey(project, { nodeId: id });
    const inputs = inputEdges(project, id).map((e) => next[e.from.nodeId]?.status.state);
    const node = project.nodes.find((n) => n.id === id);
    if (node?.type === 'source' && isDetached(node.sourceId)) {
      next[id] = { key, status: { state: 'detached' } };
      continue;
    }
    const kept = prev[id];
    // A kept status must not outlive a detached input: re-check once the file is chosen again.
    if (kept && kept.key === key && kept.status.state !== 'pending' && kept.status.state !== 'detached' && kept.status.state !== 'blocked') {
      next[id] = kept;
      continue;
    }
    if (inputs.some((s) => s === 'error' || s === 'blocked' || s === 'unwired' || s === 'detached')) {
      next[id] = { key, status: inputs.includes('unwired') ? { state: 'unwired' } : { state: 'blocked' } };
      continue;
    }
    try {
      compile(project, { nodeId: id });
    } catch (e) {
      const unwired = e instanceof CompileError && /has no input/.test(e.message);
      next[id] = { key, status: unwired ? { state: 'unwired' } : { state: 'error', message: (e as Error).message } };
      continue;
    }
    try {
      const columns = await cache.get(project, { nodeId: id });
      if (gen !== generation) return;
      next[id] = { key, status: { state: 'ok', columns } };
      void countRows(engine, project, id).then(
        (rows) => {
          const cur = useFlowStore.getState().nodes[id];
          if (cur?.key !== key || cur.status.state !== 'ok') return;
          const entry = { key, status: { ...cur.status, rows } };
          if (gen === generation) next[id] = entry;
          useFlowStore.setState((s) => ({ nodes: { ...s.nodes, [id]: entry } }));
        },
        () => undefined,
      );
    } catch (e) {
      if (gen !== generation) return;
      const err = toEngineError(e);
      next[id] = { key, status: { state: 'error', message: err.message, ...(err.code === 'stopped' ? { stopped: true } : {}) } };
    }
    publish();
  }
  publish();
}
