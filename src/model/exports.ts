// The export log: what was exported from which Output node, and any failing rules it went past.
import { nodeById, outputEdges, upstreamIds } from './graph';
import { newId } from './ids';
import { EXPORT_LOG_LIMIT, type ExportLogEntry, type OutputNode, type Project } from './schema';

export function logExport(project: Project, entry: Omit<ExportLogEntry, 'id'>, id = newId('x')): Project {
  return { ...project, exportLog: [{ id, ...entry }, ...project.exportLog].slice(0, EXPORT_LOG_LIMIT) };
}

/** Change an Output node's export settings. */
export function setOutputSpec(project: Project, nodeId: string, patch: Partial<OutputNode['outputSpec']>): Project {
  return { ...project, nodes: project.nodes.map((n) => (n.id === nodeId && n.type === 'output' ? { ...n, outputSpec: { ...n.outputSpec, ...patch } } : n)) };
}

/**
 * Switch an Output node to another format. The file name stays; the old format's options are dropped, since they
 * don't apply to the new one. Picking the format it already has changes nothing.
 */
export function setOutputFormat(project: Project, nodeId: string, format: OutputNode['outputSpec']['format']): Project {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (node?.type !== 'output' || node.outputSpec.format === format) return project;
  return setOutputSpec(project, nodeId, { format, options: {} });
}

/** The Output node wired straight after a node, if it has one: where an export of that node's rows goes. */
export function outputAfter(project: Project, nodeId: string): OutputNode | undefined {
  for (const e of outputEdges(project, nodeId)) {
    const to = nodeById(project, e.to.nodeId);
    if (to?.type === 'output') return to;
  }
  return undefined;
}

/**
 * A file name (no extension) for an export of a node's rows, after the data rather than the Output node: a flow that
 * reads one source, sales.csv, exports sales-clean, and the source itself exports as sales. Undefined when the rows
 * come from several sources or none, where the Output's own name says more.
 */
export function exportNameAfter(project: Project, nodeId: string): string | undefined {
  const node = nodeById(project, nodeId);
  if (!node) return undefined;
  const sources = [...new Set([nodeId, ...upstreamIds(project, nodeId)])].flatMap((id) => nodeById(project, id) ?? []).flatMap((n) => (n.type === 'source' ? [n] : []));
  if (sources.length !== 1) return undefined;
  const name = (project.sources.find((s) => s.id === sources[0]!.sourceId)?.name ?? sources[0]!.name).trim();
  // "sales.2024.csv" keeps its inner dot; a name that is all extension (".csv") is left whole.
  const base = name.replace(/(?<=.)\.[A-Za-z0-9]{1,8}$/, '').trim();
  if (!base) return undefined;
  return node.type === 'source' ? base : `${base}-clean`;
}
