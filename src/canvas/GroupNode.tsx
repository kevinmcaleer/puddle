import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { useEffect } from 'react';
import { setGroupCollapsed, useProjectStore, type GroupPorts, type NodeGroup } from '../model';
import { viewNode } from '../results/pin';
import { Button, cx, Icon } from '../ui';
import { inHandle, outHandle } from './groupIds';

export type GroupNodeData = {
  group: NodeGroup;
  ports: GroupPorts;
  /** Node names by id, for the ports' labels. */
  names: Record<string, string>;
  /** The viewed node is inside. */
  viewed: boolean;
  /** How many nodes inside are broken. */
  broken: number;
};
export type GroupFlowNode = Node<GroupNodeData, 'group'>;

export type GroupFrameData = { group: NodeGroup; width: number; height: number };
export type GroupFrameFlowNode = Node<GroupFrameData, 'frame'>;

const open = (groupId: string) => useProjectStore.getState().apply((p) => setGroupCollapsed(p, groupId, false));

/**
 * A collapsed group, as in Blender: one card with a socket for each wire coming in and one for each result going out.
 * A result's name views it; the button (or a double click, or Enter) opens the group.
 */
export function GroupNode({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const { group, ports, names, viewed, broken } = data;
  const rows = Math.max(ports.inputs.length, ports.outputs.length);
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => updateInternals(id), [updateInternals, id, ports.inputs.length, ports.outputs.length]);
  const count = group.nodeIds.length;
  return (
    <div
      data-testid={`group-${group.name}`}
      data-status={broken ? 'error' : 'ok'}
      data-inputs={ports.inputs.length}
      data-outputs={ports.outputs.map((o) => names[o.nodeId]).join(',')}
      className={cx('ui-node puddle-group', selected && 'is-selected', viewed && 'is-viewed', broken > 0 && 'has-error')}
      data-kind="group"
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.stopPropagation();
        open(group.id);
      }}
    >
      {viewed && (
        <span className="ui-node__eye" data-testid="node-pill">
          <Icon name="eye" size={12} />
          Viewing inside
        </span>
      )}
      <div className="ui-node__head">
        <span className="ui-node__chip">
          <Icon name="group" />
        </span>
        <div className="ui-node__titles">
          <div className="ui-node__name" title={group.name}>{group.name}</div>
          <div className="ui-node__kind">
            Group · {count} {count === 1 ? 'node' : 'nodes'}
            {broken > 0 && ` · ${broken} broken`}
          </div>
        </div>
        <Button variant="ghost" size="sm" iconOnly icon="chevron-down" className="nodrag" aria-label={`Open ${group.name}`} title="Open the group" onClick={() => open(group.id)} />
      </div>
      <div className="puddle-group__ports">
        {Array.from({ length: rows }, (_, i) => {
          const input = ports.inputs[i];
          const output = ports.outputs[i];
          return (
            <div key={i} className="puddle-group__row">
              <span className="puddle-group__in">
                {input && (
                  <>
                    <Handle type="target" position={Position.Left} id={inHandle(input.edgeId)} className="ui-port" isConnectable={false} />
                    <span className="truncate" title={`${names[input.fromNodeId]} into ${names[input.toNodeId]}`}>
                      {names[input.fromNodeId]}
                    </span>
                  </>
                )}
              </span>
              <span className="puddle-group__out">
                {output && (
                  <>
                    <button type="button" className="nodrag puddle-group__result truncate" title={`View ${names[output.nodeId]}`} onClick={() => viewNode(output.nodeId)}>
                      {names[output.nodeId]}
                    </button>
                    <Handle type="source" position={Position.Right} id={outHandle(output.nodeId)} className="ui-port" />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** An open group: a labelled frame drawn behind its nodes, with a button to close it again. */
export function GroupFrame({ data }: NodeProps<GroupFrameFlowNode>) {
  const { group, width, height } = data;
  return (
    <div className="puddle-group-frame" style={{ width, height }} data-testid={`frame-${group.name}`}>
      <div className="puddle-group-frame__head">
        <Icon name="group" size={14} />
        <span className="truncate">{group.name}</span>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="chevron-up"
          className="nodrag"
          aria-label={`Close ${group.name}`}
          title="Close the group"
          onClick={() => useProjectStore.getState().apply((p) => setGroupCollapsed(p, group.id, true))}
        />
      </div>
    </div>
  );
}
