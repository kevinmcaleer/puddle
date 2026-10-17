// The export log: what was exported from which Output node, and any failing rules it went past.
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
