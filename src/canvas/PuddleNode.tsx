import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useNodeStatus } from '../flow/status';
import type { GraphNode } from '../model';
import { NodeCard } from '../ui';

export type PuddleNodeData = { node: GraphNode; viewed: boolean; label?: ReactNode; detail?: string };
export type PuddleFlowNode = Node<PuddleNodeData, 'puddle'>;

/** A graph node on the canvas: the design system's NodeCard with React Flow handles where its ports sit. */
export function PuddleNode({ data, selected }: NodeProps<PuddleFlowNode>) {
  const { node, viewed, detail } = data;
  const status = useNodeStatus(node.id);
  const steps = node.type === 'transform' ? node.steps.map((s) => ({ label: s.label, disabled: !s.enabled })) : undefined;
  const ok = status.state === 'ok' ? status : null;
  return (
    <div data-testid={`node-${node.name}`} data-status={status.state}>
      <NodeCard
        kind={node.type}
        name={node.name}
        detail={detail}
        steps={steps}
        expanded={node.collapsed === false}
        rows={ok?.rows}
        cols={ok?.columns.length}
        selected={selected}
        viewed={viewed}
        error={status.state === 'error' ? status.message : status.state === 'detached' ? 'File not connected. Choose it again in the inspector.' : undefined}
        dimmed={status.state === 'blocked'}
        brokenInput={status.state === 'error'}
        renderPorts={({ inputs, output }) => (
          <>
            {inputs.map((top, i) => (
              <Handle key={i} type="target" position={Position.Left} id={String(i)} className={status.state === 'error' ? 'ui-port is-broken' : 'ui-port'} style={{ top }} />
            ))}
            {output && <Handle type="source" position={Position.Right} className="ui-port" />}
          </>
        )}
      />
    </div>
  );
}
