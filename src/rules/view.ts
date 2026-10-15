import { useProjectStore } from '../model';

/** Show only the rows of this node that fail the rule; showing all rows again clears it. */
export function showFailing(nodeId: string, ruleId: string | undefined) {
  useProjectStore.getState().setView({ viewedNodeId: nodeId, viewedStepIndex: undefined, failingRuleId: ruleId });
}
