// Fitting a recipe to the file attached to one of its sources: the column mapping from node templates, applied to a
// whole pipeline. Mapped columns are renamed back to the names the recipe expects right after the source, so every
// node after it (joins, lookups, rules and outputs as well as steps) reads them as before.
import { downstreamIds, newId, nodeById, outputEdges, updateSource, type ColumnSchema, type Project, type Step } from '../model';
import { relabel } from '../steps';
import { missingColumns, stepColumns, unmappedReason } from '../templates/mapping';

const lower = (name: string) => name.toLowerCase();

/** The name of the Transform node added to hold the renames when the source doesn't feed a Transform node of its own. */
export const MATCH_NODE_NAME = 'Match columns';

/**
 * The project with source `sourceId` fitted to a file with `actual` columns. Each expected column the file lacks
 * that `mapping` names a file column for is renamed from it, in one Rename columns step at the start of the Transform
 * node the source feeds (or a new one between them); steps after the source that read a column left unmapped arrive
 * turned off, saying which. The source stops expecting columns either way.
 */
export function matchSource(project: Project, sourceId: string, actual: ColumnSchema[], mapping: Record<string, string | undefined>): Project {
  const source = project.sources.find((s) => s.id === sourceId);
  const sourceNode = project.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId);
  let next = updateSource(project, sourceId, { expected: undefined });
  if (!source?.expected || !sourceNode) return next;
  const expected = source.expected;
  const renames: { from: string; to: string }[] = [];
  const unmapped = new Set<string>();
  for (const m of missingColumns(expected, actual)) {
    const from = mapping[m.expected.name];
    if (from && actual.some((a) => a.name === from)) renames.push({ from, to: m.expected.name });
    else unmapped.add(lower(m.expected.name));
  }

  if (renames.length) {
    const rename = relabel({ id: newId('st'), type: 'renameColumns', label: '', enabled: true, params: { renames } });
    const out = outputEdges(next, sourceNode.id);
    const only = out.length === 1 ? nodeById(next, out[0]!.to.nodeId) : undefined;
    if (only?.type === 'transform') {
      next = { ...next, nodes: next.nodes.map((n) => (n.id === only.id && n.type === 'transform' ? { ...n, steps: [rename, ...n.steps] } : n)) };
    } else {
      const id = newId('n');
      const { x, y } = sourceNode.position;
      next = {
        ...next,
        nodes: [...next.nodes, { id, type: 'transform', name: MATCH_NODE_NAME, position: { x: x + 120, y: y + 100 }, rules: [], steps: [rename] }],
        edges: [...next.edges.map((e) => (e.from.nodeId === sourceNode.id ? { ...e, from: { nodeId: id } } : e)), { id: newId('e'), from: { nodeId: sourceNode.id }, to: { nodeId: id, port: 0 } }],
      };
    }
  }

  if (unmapped.size) {
    const names = expected.map((c) => c.name);
    const after = downstreamIds(next, sourceNode.id);
    const turnOff = (step: Step): Step => {
      if (!step.enabled) return step;
      const lacking = stepColumns(step, names).filter((c) => unmapped.has(lower(c)));
      if (!lacking.length) return step;
      const shown = [...new Set(lacking.map((c) => expected.find((e) => lower(e.name) === lower(c))?.name ?? c))];
      return { ...step, enabled: false, disabledReason: unmappedReason(shown) };
    };
    next = { ...next, nodes: next.nodes.map((n) => (n.type === 'transform' && after.has(n.id) ? { ...n, steps: n.steps.map(turnOff) } : n)) };
  }
  return next;
}
