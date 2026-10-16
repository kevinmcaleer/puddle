import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { upstreamKey } from '../compiler';
import { useViewProject } from '../flow/sample';
import { exportGate } from '../flow/gate';
import { keptLabel, keptView, useKeptEntry } from '../flow/kept';
import { summarise, useRuleStore } from '../flow/rules';
import { useNodeStatus } from '../flow/status';
import { inputPorts, useProject, type GraphNode } from '../model';
import { urlProblem, useUrlFetches } from '../sources/url';
import { NodeCard } from '../ui';
import { portBroken, portName, portsHeight, portTop } from './ports';

export type PuddleNodeData = { node: GraphNode; viewed: boolean; label?: ReactNode; detail?: string };
export type PuddleFlowNode = Node<PuddleNodeData, 'puddle'>;

/** A graph node on the canvas: the design system's NodeCard with React Flow handles where its ports sit. */
export function PuddleNode({ data, selected }: NodeProps<PuddleFlowNode>) {
  const { node, viewed, detail } = data;
  const status = useNodeStatus(node.id);
  const steps = node.type === 'transform' ? node.steps.map((s) => ({ label: s.label, disabled: !s.enabled })) : undefined;
  const ok = status.state === 'ok' ? status : null;
  const project = useProject();
  const ports = inputPorts(project, node);
  const keptEntry = useKeptEntry(node.id);
  // Kept tables are built from the project as evaluated: the sampled copy in sample mode.
  const view = useViewProject();
  const keepKey = useMemo(() => (node.pinnedResult ? upstreamKey(view, { nodeId: node.id }) : null), [view, node.pinnedResult, node.id]);
  const kept = keepKey != null && node.type !== 'output' ? keptView(keptEntry, keepKey) : null;
  const numbered = node.type === 'append';
  // An Append gains an input as its last one is wired: React Flow has to measure the new handle.
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => updateInternals(node.id), [updateInternals, node.id, ports.length]);
  const allResults = useRuleStore((s) => s.nodes);
  const own = ok ? summarise(node.rules, allResults[node.id]?.results) : undefined;
  // An Output node shows when a failing rule upstream blocks its export, even with no rules of its own.
  const blocked = ok && node.type === 'output' && exportGate(project, node.id, allResults).state === 'blocked';
  const rule = blocked && own?.status !== 'fail' ? { status: 'fail' as const, label: 'Export blocked' } : own;
  const source = node.type === 'source' ? project.sources.find((s) => s.id === node.sourceId) : undefined;
  const fetch = useUrlFetches((s) => (source?.kind === 'url' ? s.fetches[source.id] : undefined));
  // A URL source being fetched is dimmed until its file arrives; one that can't be fetched says why.
  const fetching = source?.kind === 'url' && fetch?.state !== 'failed';
  const detached = source?.kind === 'url' && source.url ? (fetching ? undefined : urlProblem(fetch, source.url.href).message) : 'File not connected. Choose it again in the inspector.';
  return (
    <div data-testid={`node-${node.name}`} data-status={status.state} data-rules={rule?.status} data-export={node.type === 'output' && ok ? (blocked ? 'blocked' : 'ready') : undefined} data-fetch={fetch?.state}>
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
        error={status.state === 'error' ? status.message : status.state === 'detached' ? detached : undefined}
        dimmed={status.state === 'blocked' || (status.state === 'detached' && fetching)}
        brokenInput={status.state === 'error'}
        note={node.notes?.trim() || undefined}
        kept={kept ? { label: keptLabel(kept), stale: kept.state !== 'ready' } : undefined}
        style={ports.length > 2 ? { minHeight: portsHeight(ports.length) } : undefined}
        renderPorts={({ output }) => (
          <>
            {ports.map((port, i) => (
              <Handle
                key={String(port.id)}
                type="target"
                position={Position.Left}
                id={String(port.id)}
                className={portBroken(status, port.id) ? 'ui-port is-broken' : 'ui-port'}
                style={{ top: portTop(i, ports.length) }}
                title={ports.length > 1 ? portName(port) : undefined}
                aria-label={ports.length > 1 ? portName(port) : undefined}
              >
                {/* An Append's inputs are numbered on the node, so the order rows stack in is visible. */}
                {numbered && <span className="ui-metric puddle-port-label">{Number(port.id) + 1}</span>}
              </Handle>
            ))}
            {output && <Handle type="source" position={Position.Right} className="ui-port" />}
          </>
        )}
      />
    </div>
  );
}
