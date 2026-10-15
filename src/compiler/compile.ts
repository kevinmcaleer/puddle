import { hashValue, inputEdges, nodeById, topoSort, upstreamIds, type GraphNode, type Project } from '../model';
import { CompileError } from './errors';
import { sourceRelation } from './sources';
import { cteName, ident, num } from './sql';
import { stepParams } from './steps';

export const PAGE_SIZE = 500;

export interface Target {
  nodeId: string;
  /** Preview step k inside a transform node: only steps 0..k are compiled. Omit for the whole node. */
  stepIndex?: number;
}

export interface Compiled {
  /** A complete SELECT statement for the target's rows. */
  sql: string;
  /** The CTE the target reads from, so callers can wrap it (COUNT, rules, COPY TO). */
  output: string;
  /** Nodes the statement depends on, in topological order. */
  nodeIds: string[];
}

function inputCte(project: Project, node: GraphNode, out: Map<string, string>): string {
  const [edge] = inputEdges(project, node.id);
  if (!edge) throw new CompileError(`${node.name} has no input. Connect a wire into it.`, node.id);
  const cte = out.get(edge.from.nodeId);
  if (!cte) throw new CompileError(`${node.name} is connected to a node that no longer exists.`, node.id);
  return cte;
}

/**
 * Compile the flow upstream of a node into one WITH chain: one CTE per source, one per enabled step,
 * and a final SELECT of the target. Pure: the same project and target always give the same SQL.
 */
export function compile(project: Project, target: Target): Compiled {
  const node = nodeById(project, target.nodeId);
  if (!node) throw new CompileError('That node no longer exists.', target.nodeId);
  const order = topoSort(project, upstreamIds(project, target.nodeId));
  const ctes: string[] = [];
  const out = new Map<string, string>();

  for (const id of order) {
    const n = nodeById(project, id)!;
    switch (n.type) {
      case 'source': {
        const source = project.sources.find((s) => s.id === n.sourceId);
        if (!source) throw new CompileError(`${n.name} has lost its source. Add the file again.`, n.id);
        const name = cteName(n.id);
        ctes.push(`${name} AS (SELECT * FROM ${sourceRelation(source)})`);
        out.set(n.id, name);
        break;
      }
      case 'transform': {
        let cur = inputCte(project, n, out);
        const last = id === target.nodeId && target.stepIndex != null ? target.stepIndex : n.steps.length - 1;
        if (last >= n.steps.length) throw new CompileError(`${n.name} has no step ${last + 1}.`, n.id);
        n.steps.slice(0, last + 1).forEach((step, k) => {
          if (!step.enabled) return;
          const { def, params } = stepParams(step, n.id);
          const name = cteName(n.id, k);
          ctes.push(`${name} AS (${def.compile(params, { input: cur })})`);
          cur = name;
        });
        out.set(n.id, cur);
        break;
      }
      case 'output':
        out.set(n.id, inputCte(project, n, out));
        break;
    }
  }

  const output = out.get(target.nodeId)!;
  const sql = ctes.length ? `WITH ${ctes.join(',\n  ')}\nSELECT * FROM ${output}` : `SELECT * FROM ${output}`;
  return { sql, output, nodeIds: order };
}

/** The target's rows for one page of the results table. */
export function compilePreview(project: Project, target: Target, page = 0, pageSize = PAGE_SIZE): string {
  if (!Number.isInteger(page) || page < 0) throw new RangeError(`Bad page: ${page}`);
  return `${compile(project, target).sql}\nLIMIT ${num(pageSize)} OFFSET ${num(page * pageSize)}`;
}

/**
 * One page of the results table with every column cast to text, so the grid shows exactly what DuckDB
 * would print (dates, decimals, nested values) instead of Arrow's raw encodings. Nulls stay null.
 */
export function compileDisplayPage(project: Project, target: Target, columns: string[], page = 0, pageSize = PAGE_SIZE): string {
  if (!Number.isInteger(page) || page < 0) throw new RangeError(`Bad page: ${page}`);
  const select = columns.length ? columns.map((c) => `CAST(${ident(c)} AS VARCHAR) AS ${ident(c)}`).join(', ') : '*';
  return `SELECT ${select} FROM (${compile(project, target).sql})\nLIMIT ${num(pageSize)} OFFSET ${num(page * pageSize)}`;
}

/** Per-column profile for the quality bars: the share of empty values, from SUMMARIZE. */
export function compileProfile(project: Project, target: Target): string {
  return `SELECT column_name, CAST(null_percentage AS DOUBLE) AS null_pct, approx_unique FROM (SUMMARIZE SELECT * FROM (${compile(project, target).sql}))`;
}

/** The target's full row count. */
export function compileCount(project: Project, target: Target): string {
  return `SELECT COUNT(*) AS n FROM (${compile(project, target).sql})`;
}

/**
 * A key that changes exactly when the target's output could change: node types, wiring, steps up to the
 * target step, and source formats, options and file identity. Names, notes and positions are ignored.
 */
export function upstreamKey(project: Project, target: Target): string {
  const ids = upstreamIds(project, target.nodeId);
  const nodes = project.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const inputs = inputEdges(project, n.id).map((e) => [e.from.nodeId, e.to.port]);
      if (n.type === 'source') {
        const s = project.sources.find((x) => x.id === n.sourceId);
        return { id: n.id, type: n.type, inputs, source: s && { id: s.id, format: s.format, parseOptions: s.parseOptions, file: s.file?.headHash, size: s.file?.size, clip: s.clipboard?.text } };
      }
      if (n.type === 'transform') {
        const steps = n.id === target.nodeId && target.stepIndex != null ? n.steps.slice(0, target.stepIndex + 1) : n.steps;
        return { id: n.id, type: n.type, inputs, steps: steps.map((s) => ({ type: s.type, enabled: s.enabled, params: s.params })) };
      }
      return { id: n.id, type: n.type, inputs };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return hashValue({ target: [target.nodeId, target.stepIndex ?? null], nodes });
}
