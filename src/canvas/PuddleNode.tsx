import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { exportGate } from '../flow/gate';
import { summarise, useRuleStore } from '../flow/rules';
import { useNodeStatus } from '../flow/status';
import { useProject, type GraphNode } from '../model';
import { NodeCard } from '../ui';

export type PuddleNodeData = { node: GraphNode; viewed: boolean; label?: ReactNode; detail?: string };
export type PuddleFlowNode = Node<PuddleNodeData, 'puddle'>;

/** A graph node on the canvas: the design system's NodeCard with React Flow handles where its ports sit. */
export function PuddleNode({ data, selected }: NodeProps<PuddleFlowNode>) {
  const { node, viewed, detail } = data;
  const status = useNodeStatus(node.id);
  const steps = node.type === 'transform' ? node.steps.map((s) => ({ label: s.label, disabled: !s.enabled })) : undefined;
  const ok = status.state === 'ok' ? status : null;
  const project = useProject();
  const allResults = useRuleStore((s) => s.nodes);
  const own = ok ? summarise(node.rules, allResults[node.id]?.results) : undefined;
  // An Output node shows when a failing rule upstream blocks its export, even with no rules of its own.
  const blocked = ok && node.type === 'output' && exportGate(project, node.id, allResults).state === 'blocked';
  const rule = blocked && own?.status !== 'fail' ? { status: 'fail' as const, label: 'Export blocked' } : own;
  return (
    <div data-testid={`node-${node.name}`} data-status={status.state} data-rules={rule?.status} data-export={node.type === 'output' && ok ? (blocked ? 'blocked' : 'ready') : undefined}>
      <NodeCard
        kind={node.type}
        name={node.name}
        detail={detail}
        steps={steps}
        expanded={node.collapsed === false}
        rows={ok?.rows}
        cols={ok?.columns.length}
        rule={rule}
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
