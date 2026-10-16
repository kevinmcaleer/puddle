import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnMove,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { addFiles, addNodeAfterSelection } from '../app/actions';
import { droppedFiles } from '../sources/handles';
import { ReconnectBanner } from '../sources/ReconnectBanner';
import { useSession } from '../app/session';
import { useFlowStore } from '../flow/status';
import { JOIN_TYPES, ruleRefs } from '../compiler';
import { canConnect, canGroup, connect, freePort, groupNodes, hasOutput, inputPorts, moveNodes, newId, parsePort, removeNodes, samePort, setCollapsed, upstreamIds, useProject, useProjectStore, type GraphNode } from '../model';
import { Banner, Button } from '../ui';
import { viewNode } from '../results/pin';
import { hostOf } from '../sources/url';
import { formatLabel } from './formatLabel';
import { portBroken, portName } from './ports';
import { PuddleNode, type PuddleFlowNode } from './PuddleNode';
import { RefEdge, type RefFlowEdge } from './RefEdge';
import { WireEdge, type WireFlowEdge } from './WireEdge';
import './canvas.css';

const nodeTypes = { puddle: PuddleNode };
const edgeTypes = { wire: WireEdge, reference: RefEdge };

type PuddleEdge = WireFlowEdge | RefFlowEdge;

/** One dashed reference per pair of nodes where a rule on one reads the other. */
function referenceEdges(project: ReturnType<typeof useProject>): RefFlowEdge[] {
  const byPair = new Map<string, RefFlowEdge>();
  for (const n of project.nodes)
    for (const r of n.rules)
      for (const ref of ruleRefs(r)) {
        const from = project.nodes.find((x) => x.id === ref);
        if (!from || from.id === n.id) continue;
        const id = `ref:${from.id}:${n.id}`;
        const edge = byPair.get(id) ?? { id, type: 'reference' as const, source: from.id, sourceHandle: 'ref-out', target: n.id, targetHandle: 'ref-in', selectable: false, deletable: false, focusable: false, data: { label: `${from.name}->${n.name}`, rules: [] } };
        edge.data!.rules.push(r.label);
        byPair.set(id, edge);
      }
  return [...byPair.values()];
}

/** Which nodes a dashed reference starts from and ends at, so only those get its hidden handles. */
function referenceEnds(project: ReturnType<typeof useProject>) {
  const from = new Set<string>();
  const to = new Set<string>();
  for (const e of referenceEdges(project)) {
    from.add(e.source);
    to.add(e.target);
  }
  return { from, to };
}

function detailFor(node: GraphNode, sources: ReturnType<typeof useProject>['sources'], edges: ReturnType<typeof useProject>['edges']): string | undefined {
  // A Join shows its type under its name.
  if (node.type === 'join') return `Join · ${JOIN_TYPES[node.joinSpec.kind].label}`;
  if (node.type === 'lookup') {
    const n = node.lookupSpec.columns.length;
    return `Lookup · ${n ? `${n} ${n === 1 ? 'column' : 'columns'}` : 'no columns yet'}`;
  }
  if (node.type === 'append') {
    const n = edges.filter((e) => e.to.nodeId === node.id).length;
    return `Append · ${n} ${n === 1 ? 'input' : 'inputs'}${node.appendSpec.match === 'position' ? ' by position' : ''}`;
  }
  if (node.type === 'query') {
    const n = edges.filter((e) => e.to.nodeId === node.id).length;
    return `Query · ${n} ${n === 1 ? 'table' : 'tables'}`;
  }
  if (node.type !== 'source') return undefined;
  const s = sources.find((x) => x.id === node.sourceId);
  if (!s) return 'Source';
  if (s.kind === 'url' && s.url) return `${hostOf(s.url.href)} · ${formatLabel(s.format)}`;
  return s.kind === 'clipboard' ? `Source · Pasted ${formatLabel(s.format)}` : `Source · ${formatLabel(s.format)}`;
}

/** Shown when several nodes are selected: group them into one, or say why they can't be; join two, look up from one into the other, append them, or query them. */
function GroupBar({ ids }: { ids: string[] }) {
  const project = useProject();
  const check = canGroup(project, ids);
  const combinable = ids.every((id) => project.nodes.some((n) => n.id === id && hasOutput(n)));
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
        {combinable && ids.length === 2 && (
          <Button size="sm" variant="secondary" icon="join" onClick={() => addNodeAfterSelection('join')}>
            Join these two
          </Button>
        )}
        {combinable && ids.length === 2 && (
          <Button size="sm" variant="secondary" icon="join" onClick={() => addNodeAfterSelection('lookup')}>
            Look up from the second
          </Button>
        )}
        {combinable && (
          <Button size="sm" variant="secondary" icon="append" onClick={() => addNodeAfterSelection('append')}>
            Append these
          </Button>
        )}
        {combinable && (
          <Button size="sm" variant="secondary" icon="query" onClick={() => addNodeAfterSelection('query')}>
            Query these
          </Button>
        )}
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
  // Selected wires, so Delete removes a wire on its own. Nodes' selection lives in the session.
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const rf = useReactFlow();

  const viewedId = project.view.viewedNodeId;
  const activeIds = useMemo(() => (viewedId && project.nodes.some((n) => n.id === viewedId) ? upstreamIds(project, viewedId) : new Set<string>()), [project, viewedId]);

  const nodes: PuddleFlowNode[] = useMemo(() => {
    const ends = referenceEnds(project);
    return project.nodes.map((n) => ({
      id: n.id,
      type: 'puddle',
      position: dragging[n.id] ?? n.position,
      selected: selectedNodeIds.includes(n.id),
      data: { node: n, viewed: n.id === viewedId, detail: detailFor(n, project.sources, project.edges), refIn: ends.to.has(n.id), refOut: ends.from.has(n.id) },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- references are read from project.nodes
  }, [project.nodes, project.sources, project.edges, dragging, selectedNodeIds, viewedId],
  );

  const edges: PuddleEdge[] = useMemo(
    () => [
      ...project.edges.map((e): WireFlowEdge => {
        const to = statuses[e.to.nodeId]?.status;
        const from = statuses[e.from.nodeId]?.status.state;
        // A wire turns red when the node it feeds breaks on what it carries (on this input, when the error says which).
        const broken = !!to && portBroken(to, e.to.port) && from === 'ok';
        const active = activeIds.has(e.from.nodeId) && activeIds.has(e.to.nodeId);
        const name = (id: string) => project.nodes.find((n) => n.id === id)?.name ?? id;
        const target = project.nodes.find((n) => n.id === e.to.nodeId);
        const ports = target ? inputPorts(project, target) : [];
        const spec = ports.length > 1 ? ports.find((p) => samePort(p.id, e.to.port)) : undefined;
        return {
          id: e.id,
          type: 'wire',
          source: e.from.nodeId,
          target: e.to.nodeId,
          targetHandle: String(e.to.port),
          selected: selectedEdges.includes(e.id),
          data: { state: broken ? 'broken' : active ? 'active' : 'idle', fromNodeId: e.from.nodeId, hovered: hoveredEdge === e.id, label: `${name(e.from.nodeId)}->${name(e.to.nodeId)}`, port: spec && String(spec.id), portName: spec && portName(spec) },
        };
      }),
      ...referenceEdges(project),
    ],
    [project, statuses, activeIds, hoveredEdge, selectedEdges],
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
      const present = useProjectStore.getState().history.present;
      // The input the wire was dropped on; the first free one when React Flow doesn't say.
      const port = parsePort(c.targetHandle) ?? freePort(present, c.target);
      const check = canConnect(present, c.source, c.target, port);
      if (!check.ok || port == null) {
        useSession.getState().notify({ tone: 'warn', text: check.ok ? 'That node has no free input.' : check.reason });
        return;
      }
      useSession.getState().notify(null);
      apply((p) => connect(p, { id: newId('e'), from: { nodeId: c.source }, to: { nodeId: c.target, port } }));
    },
    [apply],
  );

  const onMoveEnd: OnMove = useCallback((_e, viewport) => setView({ canvasViewport: viewport }), [setView]);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // Handles (Chromium) must be asked for before anything is awaited, while the drop's data is still readable.
    await addFiles(await droppedFiles(e.dataTransfer), at);
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
      <ReactFlow<PuddleFlowNode, PuddleEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={project.view.canvasViewport}
        onNodesChange={onNodesChange}
        onEdgesChange={(changes: EdgeChange<PuddleEdge>[]) => {
          const select = changes.flatMap((c) => (c.type === 'select' ? [c] : []));
          if (select.length) setSelectedEdges((ids) => [...ids.filter((id) => !select.some((c) => c.id === id)), ...select.filter((c) => c.selected).map((c) => c.id)]);
        }}
        // Selecting a wire leaves the nodes, so Delete only takes the wire.
        onEdgeClick={() => useSession.getState().select(null)}
        onConnect={onConnect}
        onMoveEnd={onMoveEnd}
        onNodeClick={(e, n) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) return useSession.getState().toggleSelected(n.id);
          useSession.getState().select(n.id);
          viewNode(n.id);
        }}
        onNodeDoubleClick={(_e, n) => {
          if (n.data.node.type === 'transform') apply((p) => setCollapsed(p, n.id, n.data.node.collapsed !== false));
          // A Query opens in its designer, as a query does in Access.
          if (n.data.node.type === 'query') useSession.getState().openDesigner(n.id);
        }}
        onPaneClick={() => useSession.getState().select(null)}
        onDelete={({ nodes: delNodes, edges: delEdges }) => {
          // One undo step for the whole deletion, nodes and wires together.
          apply((p) => removeNodes({ ...p, edges: p.edges.filter((e) => !delEdges.some((d) => d.id === e.id)) }, delNodes.map((n) => n.id)));
          setSelectedEdges([]);
        }}
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

      <div className="pointer-events-none absolute left-4 right-4 top-4 z-panel mx-auto flex max-w-[560px] flex-col gap-2 [&>*]:pointer-events-auto">
        <ReconnectBanner />
        {notice && (
          <div data-testid="canvas-notice">
            <Banner tone={notice.tone} action={<Button variant="ghost" size="sm" onClick={() => useSession.getState().notify(null)}>Dismiss</Button>}>
              {notice.text}
            </Banner>
          </div>
        )}
      </div>
    </div>
  );
}
