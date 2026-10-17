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
import { useCallback, useEffect, useMemo, useState, type DragEvent, type FocusEvent } from 'react';
import { addFiles, addNodeAfterSelection, wireNodes } from '../app/actions';
import { droppedFiles } from '../sources/handles';
import { FilesNotKeptBanner, ReconnectBanner } from '../sources/ReconnectBanner';
import { useSession } from '../app/session';
import { useFlowStore } from '../flow/status';
import { JOIN_TYPES, ruleRefs } from '../compiler';
import { canGroup, groupNodes, hasOutput, inputPorts, moveNodes, parsePort, removeNodes, samePort, setCollapsed, upstreamIds, useProject, useProjectStore, type GraphNode } from '../model';
import { Banner, Button } from '../ui';
import { viewNode } from '../results/pin';
import { hostOf } from '../sources/url';
import { openSamplesDialog } from '../samples/samplesDialog';
import { TourOffer } from '../tour/TourOffer';
import { CANVAS_ARIA, nodeLabel, wireLabel } from './a11y';
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
  if (s.kind === 'url' && s.url) return `${s.url.sample ? 'Sample' : hostOf(s.url.href)} · ${formatLabel(s.format)}`;
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
  const connectFrom = useSession((s) => s.connectFrom);
  const statuses = useFlowStore((s) => s.nodes);
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  // Each node's size as React Flow measured it. The nodes below are rebuilt on every change to the flow, and a node
  // handed over without its size is hidden until it is measured again: it blinked out for a frame on each update,
  // and a click in that frame landed on the pane and cleared the selection (seen in Firefox).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
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
      measured: measured[n.id],
      selected: selectedNodeIds.includes(n.id),
      ariaLabel: nodeLabel(n, { detail: detailFor(n, project.sources, project.edges), status: statuses[n.id]?.status, viewed: n.id === viewedId }),
      className: n.id === connectFrom ? 'is-wiring-from' : undefined,
      data: { node: n, viewed: n.id === viewedId, detail: detailFor(n, project.sources, project.edges), refIn: ends.to.has(n.id), refOut: ends.from.has(n.id) },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- references are read from project.nodes
  }, [project.nodes, project.sources, project.edges, dragging, measured, selectedNodeIds, viewedId, statuses, connectFrom],
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
          ariaLabel: wireLabel(name(e.from.nodeId), name(e.to.nodeId), spec && portName(spec)),
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
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const c of changes) {
        if (c.type === 'dimensions' && c.dimensions) sizes[c.id] = c.dimensions;
        if (c.type === 'position' && c.position) (c.dragging ? moving : done)[c.id] = c.position;
        if (c.type === 'position' && !c.position && !c.dragging) done[c.id] = dragging[c.id] ?? project.nodes.find((n) => n.id === c.id)!.position;
      }
      if (Object.keys(sizes).length) setMeasured((m) => ({ ...m, ...sizes }));
      if (Object.keys(moving).length) setDragging((d) => ({ ...d, ...moving }));
      if (Object.keys(done).length) {
        // One undo step per drag, committed when the drag ends.
        apply((p) => moveNodes(p, done));
        setDragging((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !(id in done))));
      }
    },
    [apply, dragging, project.nodes],
  );

  // The input the wire was dropped on; the first free one when React Flow doesn't say.
  const onConnect = useCallback((c: Connection) => {
    if (wireNodes(c.source, c.target, parsePort(c.targetHandle))) useSession.getState().notify(null);
  }, []);

  // A node reached with Tab is selected, as the arrow keys select, so the inspector follows the keyboard. (A click
  // focuses the node too, but leaves selecting to the click, which may be adding to the selection.)
  const onFocus = (e: FocusEvent) => {
    const el = e.target instanceof HTMLElement ? e.target : null;
    const id = el?.classList.contains('react-flow__node') ? el.dataset.id : undefined;
    if (id && el!.matches(':focus-visible') && useSession.getState().selectedNodeId !== id) useSession.getState().select(id);
  };
  // And a node selected from the keyboard (an arrow key, T or O) takes the focus, while the keyboard is on the canvas.
  const selectedId = useSession((s) => s.selectedNodeId);
  useEffect(() => {
    const active = document.activeElement;
    const onCanvas = active === document.body || !!active?.closest('main[aria-label="Canvas"]');
    if (!selectedId || !onCanvas || active?.closest('.puddle-canvas button, .puddle-canvas [role="menu"]')) return;
    // A node just added is drawn, and can take focus once React Flow has measured it, a few frames later.
    let frame = 0;
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLElement>(`.puddle-canvas .react-flow__node[data-id="${CSS.escape(selectedId)}"]`);
      el?.focus();
      if (document.activeElement !== el && tries++ < 60) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

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
      onFocus={onFocus}
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
        ariaLabelConfig={CANVAS_ARIA}
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
            <h2 className="font-display text-title text-ink">Start with a source</h2>
            <p className="text-ink-muted">
              Add a CSV, TSV, JSON or Parquet file, drop one here, or paste from the clipboard. Nothing leaves your browser. Projects save the steps, not the data.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" icon="plus" onClick={onAddSource}>Add source</Button>
              <Button variant="secondary" icon="eye" onClick={() => openSamplesDialog()}>Try a sample</Button>
            </div>
            <TourOffer />
          </div>
        </div>
      )}

      {selectedNodeIds.length > 1 && <GroupBar ids={selectedNodeIds} />}

      <div className="pointer-events-none absolute left-4 right-4 top-4 z-panel mx-auto flex max-w-[560px] flex-col gap-2 [&>*]:pointer-events-auto">
        <ReconnectBanner />
        <FilesNotKeptBanner />
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
