import { create } from 'zustand';
import { compile, CompileError, compileCount, compileLoadCheck, describeFailure, SchemaCache, UnwiredError, upstreamKey } from '../compiler';
import { EngineError, tableRows, toEngineError, type EngineClient } from '../engine';
import { inputEdges, topoSort, type ColumnSchema, type GraphNode, type Port, type Project } from '../model';

/**
 * What the canvas knows about each node's output:
 * - ok: it compiles and DuckDB can describe it (rows arrive later from a background count);
 * - unwired: it has no input yet, which isn't an error;
 * - error: this node is where the flow breaks (bad step, missing column, unreadable file); `ports` names the
 *   inputs whose wires carry the cause, when it's one input of several (a join key missing on one side);
 * - blocked: something upstream is broken, so this node dims;
 * - detached: a source whose file needs choosing again after the project was reopened.
 * A Schema table node whose load breaks its table's constraints is an error listing each kind of failure in `failures`,
 * so nothing downstream reads rows the table wouldn't take.
 */
export type NodeStatus =
  | { state: 'pending' }
  | { state: 'detached' }
  | { state: 'ok'; columns: ColumnSchema[]; rows?: number }
  | { state: 'unwired' }
  | { state: 'error'; message: string; ports?: Port[]; /** Stop was pressed before it finished; Run again retries. */ stopped?: boolean; failures?: string[] }
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

/**
 * Full row count for a node (or one of its steps, or its rows failing a rule), cached by its upstream key and run at
 * background priority. A node that no longer compiles rejects: the results table can still be showing it for a moment
 * after an edit breaks it, and its effects only expect a rejection.
 */
export function countRows(engine: EngineClient, project: Project, nodeId: string, stepIndex?: number, failingRuleId?: string): Promise<number> {
  const target = { nodeId, stepIndex, failingRuleId };
  const key = upstreamKey(project, target);
  let hit = counts.get(key);
  if (!hit) {
    let sql: string;
    try {
      sql = compileCount(project, target);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    hit = engine.query(sql, { priority: 'background', label: 'Counting rows' }).then((r) => Number(tableRows(r.table)[0]!.n));
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

/** A status a node has before it is compiled (a Schema table whose table is still being built), or undefined. */
export type NodeGate = (node: GraphNode) => NodeStatus | undefined;

/**
 * What a Schema table node's load breaks: one line per kind of failure ("3 rows have no email"), empty when every row
 * fits (or nothing is loaded). The other table nodes its foreign keys may read are described first.
 */
export async function loadFailures(engine: EngineClient, project: Project, nodeId: string, cache: SchemaCache = schemaCacheFor(engine)): Promise<string[]> {
  for (const n of project.nodes) if (n.type === 'table' && n.id !== nodeId) await cache.prepare(project, { nodeId: n.id });
  const check = compileLoadCheck(project, nodeId, { schemas: cache.book });
  if (!check?.checks.length) return [];
  const row = tableRows((await engine.query(check.sql, { label: 'Checking the load' })).table)[0] ?? {};
  return check.checks.flatMap((c, i) => {
    const n = Number(row[`f${i}`] ?? 0);
    return n ? [describeFailure(c, n)] : [];
  });
}

/** "customers can’t take some of the rows loaded into it: 1 row has no name; …". */
export const loadMessage = (name: string, failures: string[]) => `${name} can’t take some of the rows loaded into it: ${failures.join('; ')}.`;

/** Re-evaluate every node whose upstream changed. Nodes whose key is unchanged keep their status. */
export async function evaluateFlow(engine: EngineClient, project: Project, isDetached: (sourceId: string) => boolean = () => false, gate: NodeGate = () => undefined): Promise<void> {
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
    const gated = node && gate(node);
    if (gated) {
      next[id] = { key, status: gated };
      continue;
    }
    const kept = prev[id];
    // A kept status must not outlive a detached input: re-check once the file is chosen again.
    if (kept && kept.key === key && kept.status.state !== 'pending' && kept.status.state !== 'detached' && kept.status.state !== 'blocked') {
      next[id] = kept;
      continue;
    }
    // Waiting on a table being built upstream: wait too.
    if (inputs.includes('pending')) {
      next[id] = { key, status: { state: 'pending' } };
      continue;
    }
    if (inputs.some((s) => s === 'error' || s === 'blocked' || s === 'unwired' || s === 'detached')) {
      next[id] = { key, status: inputs.includes('unwired') ? { state: 'unwired' } : { state: 'blocked' } };
      continue;
    }
    try {
      // A Join compiles from its inputs' columns: describe them first (usually already cached).
      await cache.prepare(project, { nodeId: id });
      if (gen !== generation) return;
      compile(project, { nodeId: id }, { schemas: cache.book });
    } catch (e) {
      if (gen !== generation) return;
      const ports = e instanceof CompileError ? e.ports : undefined;
      // Describing a Join's inputs can be stopped too.
      const stopped = e instanceof EngineError && e.code === 'stopped';
      next[id] = {
        key,
        status: e instanceof UnwiredError ? { state: 'unwired' } : { state: 'error', message: (e as Error).message, ...(ports ? { ports } : {}), ...(stopped ? { stopped: true } : {}) },
      };
      continue;
    }
    try {
      const columns = await cache.get(project, { nodeId: id });
      if (gen !== generation) return;
      if (node?.type === 'table' && inputs.length) {
        const failures = await loadFailures(engine, project, id, cache);
        if (gen !== generation) return;
        if (failures.length) {
          next[id] = { key, status: { state: 'error', message: loadMessage(node.name, failures), failures } };
          publish();
          continue;
        }
      }
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
