import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type NodeChange,
  type OnMove,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { addFiles } from '../app/actions';
import { useSession } from '../app/session';
import { useFlowStore } from '../flow/status';
import { canConnect, canGroup, connect, groupNodes, moveNodes, newId, removeNodes, setCollapsed, upstreamIds, useProject, useProjectStore, type GraphNode } from '../model';
import { Banner, Button } from '../ui';
import { formatLabel } from './formatLabel';
import { PuddleNode, type PuddleFlowNode } from './PuddleNode';
import { WireEdge, type WireFlowEdge } from './WireEdge';
import './canvas.css';

const nodeTypes = { puddle: PuddleNode };
const edgeTypes = { wire: WireEdge };

function detailFor(node: GraphNode, sources: ReturnType<typeof useProject>['sources']): string | undefined {
  if (node.type !== 'source') return undefined;
  const s = sources.find((x) => x.id === node.sourceId);
  if (!s) return 'Source';
  return s.kind === 'clipboard' ? `Source · Pasted ${formatLabel(s.format)}` : `Source · ${formatLabel(s.format)}`;
}

/** Shown when several nodes are selected: group them into one, or say why they can't be. */
function GroupBar({ ids }: { ids: string[] }) {
  const project = useProject();
  const check = canGroup(project, ids);
  return (
    <div className="absolute bottom-4 left-1/2 z-panel -translate-x-1/2" data-testid="group-bar">
      <div className="ui-popover flex w-auto items-center gap-3 px-3 py-2">
        <span className="text-ink-muted">{check.ok ? `${ids.length} nodes selected` : check.reason}</span>
        <Button
          size="sm"
          variant="primary"
          disabled={!check.ok}
          onClick={() => {
            useProjectStore.getState().apply((p) => groupNodes(p, ids));
            if (check.ok) useSession.getState().select(check.chain[0]!);
          }}
        >
          Group into one node
        </Button>
      </div>
    </div>
  );
}

/** The node canvas: the primary editing surface (plan D3, D18). */
export function Canvas({ onAddSource }: { onAddSource: () => void }) {
  const project = useProject();
  const { apply, setView } = useProjectStore.getState();
  const selectedNodeIds = useSession((s) => s.selectedNodeIds);
  const notice = useSession((s) => s.notice);
  const statuses = useFlowStore((s) => s.nodes);
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const rf = useReactFlow();

  const viewedId = project.view.viewedNodeId;
  const activeIds = useMemo(() => (viewedId && project.nodes.some((n) => n.id === viewedId) ? upstreamIds(project, viewedId) : new Set<string>()), [project, viewedId]);

  const nodes: PuddleFlowNode[] = useMemo(
    () =>
      project.nodes.map((n) => ({
        id: n.id,
        type: 'puddle',
        position: dragging[n.id] ?? n.position,
        selected: selectedNodeIds.includes(n.id),
        data: { node: n, viewed: n.id === viewedId, detail: detailFor(n, project.sources) },
      })),
    [project.nodes, project.sources, dragging, selectedNodeIds, viewedId],
  );

  const edges: WireFlowEdge[] = useMemo(
    () =>
      project.edges.map((e) => {
        const to = statuses[e.to.nodeId]?.status.state;
        const from = statuses[e.from.nodeId]?.status.state;
        const broken = to === 'error' && from === 'ok';
        const active = activeIds.has(e.from.nodeId) && activeIds.has(e.to.nodeId);
        const name = (id: string) => project.nodes.find((n) => n.id === id)?.name ?? id;
        return {
          id: e.id,
          type: 'wire',
          source: e.from.nodeId,
          target: e.to.nodeId,
          targetHandle: String(e.to.port),
          data: { state: broken ? 'broken' : active ? 'active' : 'idle', fromNodeId: e.from.nodeId, hovered: hoveredEdge === e.id, label: `${name(e.from.nodeId)}->${name(e.to.nodeId)}` },
        };
      }),
    [project.edges, project.nodes, statuses, activeIds, hoveredEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<PuddleFlowNode>[]) => {
      const moving: Record<string, { x: number; y: number }> = {};
      const done: Record<string, { x: number; y: number }> = {};
      for (const c of changes) {
        if (c.type === 'position' && c.position) (c.dragging ? moving : done)[c.id] = c.position;
        if (c.type === 'position' && !c.position && !c.dragging) done[c.id] = dragging[c.id] ?? project.nodes.find((n) => n.id === c.id)!.position;
      }
      if (Object.keys(moving).length) setDragging((d) => ({ ...d, ...moving }));
      if (Object.keys(done).length) {
        // One undo step per drag, committed when the drag ends.
        apply((p) => moveNodes(p, done));
        setDragging((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !(id in done))));
      }
    },
    [apply, dragging, project.nodes],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const check = canConnect(useProjectStore.getState().history.present, c.source, c.target);
      if (!check.ok) {
        useSession.getState().notify({ tone: 'warn', text: check.reason });
        return;
      }
      useSession.getState().notify(null);
      apply((p) => connect(p, { id: newId('e'), from: { nodeId: c.source }, to: { nodeId: c.target, port: 0 } }));
    },
    [apply],
  );

  const onMoveEnd: OnMove = useCallback((_e, viewport) => setView({ canvasViewport: viewport }), [setView]);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    await addFiles(e.dataTransfer.files, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  return (
    <div
      className={`puddle-canvas relative h-full min-h-0 ${dropping ? 'is-dropping' : ''}`}
      data-testid="canvas"
      aria-label="Canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <ReactFlow<PuddleFlowNode, WireFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={project.view.canvasViewport}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onMoveEnd={onMoveEnd}
        onNodeClick={(e, n) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) return useSession.getState().toggleSelected(n.id);
          useSession.getState().select(n.id);
          setView({ viewedNodeId: n.id, viewedStepIndex: undefined });
        }}
        onNodeDoubleClick={(_e, n) => n.data.node.type === 'transform' && apply((p) => setCollapsed(p, n.id, n.data.node.collapsed !== false))}
        onPaneClick={() => useSession.getState().select(null)}
        onDelete={({ nodes: delNodes, edges: delEdges }) =>
          // One undo step for the whole deletion, nodes and wires together.
          apply((p) => removeNodes({ ...p, edges: p.edges.filter((e) => !delEdges.some((d) => d.id === e.id)) }, delNodes.map((n) => n.id)))
        }
        onEdgeMouseEnter={(_e, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        deleteKeyCode={['Delete', 'Backspace']}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--canvas-dot)" bgColor="var(--surface-canvas)" />
        <MiniMap pannable zoomable ariaLabel="Minimap" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {project.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto flex max-w-[420px] flex-col items-center gap-3 text-center">
            <h1 className="font-display text-title text-ink">Start with a source</h1>
            <p className="text-ink-muted">
              Add a CSV, TSV, JSON or Parquet file, drop one here, or paste from the clipboard. Nothing leaves your browser. Projects save the steps, not the data.
            </p>
            <Button variant="primary" icon="plus" onClick={onAddSource}>Add source</Button>
          </div>
        </div>
      )}

      {selectedNodeIds.length > 1 && <GroupBar ids={selectedNodeIds} />}

      {notice && (
        <div className="absolute left-4 right-4 top-4 z-panel mx-auto max-w-[560px]" data-testid="canvas-notice">
          <Banner tone={notice.tone} action={<Button variant="ghost" size="sm" onClick={() => useSession.getState().notify(null)}>Dismiss</Button>}>
            {notice.text}
          </Banner>
        </div>
      )}
    </div>
  );
}
