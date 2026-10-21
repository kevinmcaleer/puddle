// Applying chosen fixes: plan the steps, place them after the node as one undo step, then show the result.
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { detectDateFormats } from '../dates';
import { placeFixes, recordAnalysis, setParseOptions, useProjectStore, type GraphNode } from '../model';
import { foundIssues, type NodeAnalysis } from './analyse';
import { planFixes } from './fixes';
import type { Issue } from './issues';

/**
 * Plan the steps for these issues and add them after the node, as one undo step; then view and select the last.
 * The analysis is kept with the node, with these issues marked fixed, for the quality report.
 */
export async function applyFixes(node: GraphNode, issues: Issue[], analysis: NodeAnalysis, now = new Date()) {
  const engine = useEngineStore.getState().engine;
  const project = useProjectStore.getState().history.present;
  const { steps, readOptions } = await planFixes(issues, {
    available: analysis.columns,
    locale: project.settings.locale,
    detectDates: engine ? (column) => detectDateFormats(engine, project, { nodeId: node.id }, column).catch(() => undefined) : undefined,
  });
  const { apply, batch, setView } = useProjectStore.getState();
  const placed = batch(() => {
    apply((p) => recordAnalysis(p, node.id, foundIssues(analysis), issues.map((i) => i.key), now.toISOString(), analysis.facts.rows));
    // Read options first: a banner skipped at the top changes what the steps see.
    if (node.type === 'source' && Object.keys(readOptions).length) {
      apply((p) => {
        const source = p.sources.find((s) => s.id === node.sourceId);
        return source ? setParseOptions(p, source.id, { ...source.parseOptions, ...readOptions }) : p;
      });
    }
    const result = placeFixes(useProjectStore.getState().history.present, node.id, steps);
    if (result) apply(() => result.project);
    return result;
  });
  if (!placed) return;
  setView({ viewedNodeId: placed.last.nodeId, viewedStepIndex: placed.last.stepIndex });
  useSession.getState().select(placed.last.nodeId);
}

