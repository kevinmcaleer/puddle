import { EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { useNodeStatus } from '../flow/status';
import { columnKind, SchemaPopover, wireClass, wirePath, type WireState } from '../ui';

/** `port` is the input the wire goes into, on nodes with more than one ("left", "0"), and `portName` what it's called ("Left input", "Input 1"). */
export type WireData = { state: WireState; fromNodeId: string; hovered: boolean; label: string; port?: string; portName?: string };
export type WireFlowEdge = Edge<WireData, 'wire'>;

/** A wire. Hovering shows the columns it carries; a wire into a broken node is drawn broken. */
/** "the left input", "input 2" */
const into = (portName: string) => (/^input/i.test(portName) ? portName.toLowerCase() : `the ${portName.toLowerCase()}`);

export function WireEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<WireFlowEdge>) {
  const from = useNodeStatus(data?.fromNodeId ?? '');
  const d = wirePath(sourceX, sourceY, targetX, targetY);
  const columns = from.state === 'ok' ? from.columns.map((c) => ({ name: c.name, type: columnKind(c.type) })) : [];
  return (
    <>
      <path id={id} className={wireClass(data?.state ?? 'idle')} d={d} data-testid={`wire-${data?.label}`} data-state={data?.state} data-port={data?.port} />
      <path d={d} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction" />
      {data?.hovered && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan puddle-wire-popover"
            style={{ transform: `translate(-50%, 8px) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)` }}
          >
            <SchemaPopover title={data.portName ? `Columns into ${into(data.portName)}` : 'Columns on this wire'} columns={columns} broken={data.state === 'broken' ? 'Doesn’t fit the next node' : undefined} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
