import { getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { wireClass } from '../ui';

/** `rules` names the rules that read the other node, for its tooltip. */
export type RefData = { label: string; rules: string[] };
export type RefFlowEdge = Edge<RefData, 'reference'>;

/**
 * A rule's reference to another node: dashed, from the bottom of the node it reads to the top of the node the
 * rule is on, so it isn't mistaken for a wire carrying data. It can't be selected or deleted; remove the rule.
 */
export function RefEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<RefFlowEdge>) {
  const [d] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <path id={id} className={wireClass('ref')} d={d} data-testid={`ref-${data?.label}`}>
      <title>{`Read by ${data?.rules.join(', ')}`}</title>
    </path>
  );
}
