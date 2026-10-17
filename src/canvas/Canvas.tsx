import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore,
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
import {
  canGroup,
  canMakeGroup,
  groupById,
  groupNodes,
  groupOf,
  groupPorts,
  hasOutput,
  inputPorts,
  makeGroup,
  moveGroup,
  moveNodes,
  newId,
  parsePort,
  removeNodes,
  renameGroup,
  samePort,
  setCollapsed,
  setGroupCollapsed,
  ungroup,
  upstreamIds,
  useProject,
  useProjectStore,
  type GraphNode,
  type NodeGroup,
} from '../model';
import { Banner, Button, ContextMenu, Dialog, Field, Icon, TextInput, type MenuItem } from '../ui';
import { shortcutText, withShortcut } from '../app/shortcuts';
import { anyNodeOffscreen } from './minimap';
import { viewNode } from '../results/pin';
import { hostOf } from '../sources/url';
import { openSamplesDialog } from '../samples/samplesDialog';
import { TourOffer } from '../tour/TourOffer';
import { CANVAS_ARIA, nodeLabel, wireLabel } from './a11y';
import { formatLabel, sourceFormatLabel } from './formatLabel';
import { focusNodeWhenDrawn } from './focusNode';
import { portBroken, portName } from './ports';
import { PuddleNode, type PuddleFlowNode } from './PuddleNode';
import { GroupFrame, GroupNode, type GroupFlowNode, type GroupFrameFlowNode } from './GroupNode';
import { groupCardId, groupFrameId, groupIdOf, inHandle, outHandle } from './groupIds';
import { RefEdge, type RefFlowEdge } from './RefEdge';
import { WireEdge, type WireFlowEdge } from './WireEdge';
import './canvas.css';

const nodeTypes = { puddle: PuddleNode, group: GroupNode, frame: GroupFrame };
const edgeTypes = { wire: WireEdge, reference: RefEdge };

type PuddleEdge = WireFlowEdge | RefFlowEdge;
type FlowNode = PuddleFlowNode | GroupFlowNode | GroupFrameFlowNode;

/** A node's size before React Flow has measured it. */
const NODE_SIZE = { width: 232, height: 96 };
/** Room round an open group's nodes, and above them for its name. */
const FRAME_PAD = 24;
const FRAME_HEAD = 32;

/** Where an open group's frame goes: round its nodes, as they are drawn now. */
function frameBox(group: NodeGroup, at: (id: string) => { x: number; y: number } | undefined, size: (id: string) => { width: number; height: number }) {
  const boxes = group.nodeIds.flatMap((id) => {
    const p = at(id);
    return p ? [{ ...p, ...size(id) }] : [];
  });
  const x = Math.min(...boxes.map((b) => b.x)) - FRAME_PAD;
  const y = Math.min(...boxes.map((b) => b.y)) - FRAME_PAD - FRAME_HEAD;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + FRAME_PAD;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + FRAME_PAD;
  return { x, y, width: right - x, height: bottom - y };
}

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
  if (s.kind === 'url' && s.url) return `${s.url.sample ? 'Sample' : hostOf(s.url.href)} · ${sourceFormatLabel(s)}`;
  return s.kind === 'clipboard' ? `Source · Pasted ${formatLabel(s.format)}` : `Source · ${formatLabel(s.format)}`;
}

/**
 * Shown when several nodes are selected: group them (as in Blender, collapsible to one card), merge a line of
 * Transforms into one node, join two, look up from one into the other, append them, or query them.
 */
function GroupBar({ ids, onGrouped }: { ids: string[]; onGrouped: (groupId: string) => void }) {
  const project = useProject();
  const group = canMakeGroup(project, ids);
  const merge = canGroup(project, ids);
  const combinable = ids.every((id) => project.nodes.some((n) => n.id === id && hasOutput(n)));
  return (
    <div className="absolute bottom-4 left-1/2 z-panel -translate-x-1/2" data-testid="group-bar">
      <div className="ui-popover flex w-auto items-center gap-3 px-3 py-2">
        <span className="text-ink-muted">{group.ok ? `${ids.length} nodes selected` : group.reason}</span>
        <Button size="sm" variant="primary" icon="group" disabled={!group.ok} title={withShortcut('Group these nodes', 'group')} onClick={() => onGrouped(groupSelected(ids))}>
          Group
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!merge.ok}
          title={merge.ok ? 'Put their steps in one Transform node' : merge.reason}
          onClick={() => {
            useProjectStore.getState().apply((p) => groupNodes(p, ids));
            if (merge.ok) useSession.getState().select(merge.chain[0]!);
          }}
        >
          Merge into one node
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

/**
 * The canvas's right-click menu on a node, a group's card or an open group's frame: group the selection, or open,
 * close, rename or ungroup the group.
 */
function NodeMenu({ at, onClose, onRename, onGrouped }: { at: { x: number; y: number; flowId: string }; onClose: () => void; onRename: (groupId: string) => void; onGrouped: (groupId: string) => void }) {
  const project = useProject();
  const apply = useProjectStore((s) => s.apply);
  const selected = useSession((s) => s.selectedNodeIds);
  const groupId = groupIdOf(at.flowId);
  const group = groupId ? groupById(project, groupId) : groupOf(project, at.flowId);
  const items: MenuItem[] = [];
  if (!groupId) {
    // Right-clicking a node outside the selection acts on that node alone, as in a file manager.
    const ids = selected.includes(at.flowId) ? selected : [at.flowId];
    const check = canMakeGroup(project, ids);
    // A lone node already in a group has nothing to group with; the group's own items follow.
    if (check.ok || !group) items.push({ label: ids.length > 1 ? `Group ${ids.length} nodes` : 'Group', icon: 'group', shortcut: shortcutText('group'), disabled: !check.ok, onSelect: () => onGrouped(groupSelected(ids)) });
  }
  if (group) {
    items.push(
      group.collapsed
        ? { label: `Open ${group.name}`, group: 'Group', onSelect: () => apply((p) => setGroupCollapsed(p, group.id, false)) }
        : { label: `Close ${group.name}`, group: 'Group', onSelect: () => apply((p) => setGroupCollapsed(p, group.id, true)) },
      { label: 'Rename group…', group: 'Group', onSelect: () => onRename(group.id) },
      { label: 'Ungroup', group: 'Group', icon: 'ungroup', onSelect: () => apply((p) => ungroup(p, group.id)) },
    );
  }
  if (!items.length) return null;
  return <ContextMenu x={at.x} y={at.y} label={group ? `Actions for ${group.name}` : 'Node actions'} items={items} onClose={onClose} />;
}

function RenameGroup({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const group = groupById(useProject(), groupId);
  const [name, setName] = useState(group?.name ?? '');
  if (!group) return null;
  return (
    <Dialog
      title="Rename group"
      confirm="Rename"
      confirmDisabled={!name.trim()}
      onClose={onClose}
      onConfirm={() => {
        useProjectStore.getState().apply((p) => renameGroup(p, groupId, name));
        onClose();
      }}
    >
      <Field label="Name" htmlFor="group-name">
        <TextInput id="group-name" data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** Group the nodes (collapsed), clearing the node selection; returns the new group's id. */
function groupSelected(ids: string[]): string {
  const id = newId('g');
  useProjectStore.getState().apply((p) => makeGroup(p, ids, id));
  useSession.getState().select(null);
  return id;
}

/** The node canvas: the primary editing surface (plan D3, D18). */
/** Whether a node is partly off the visible canvas right now, read from React Flow's own store. */
function useMinimapNeeded() {
  return useStore((s) =>
    anyNodeOffscreen(
      [...s.nodeLookup.values()].map((n) => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: n.measured.width ?? 0, height: n.measured.height ?? 0 })),
      { x: s.transform[0], y: s.transform[1], zoom: s.transform[2] },
      { width: s.width, height: s.height },
    ),
  );
}

export function Canvas({ onAddSource, onLayout }: { onAddSource: () => void; onLayout: () => void }) {
  const minimapNeeded = useMinimapNeeded();
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
  const [menu, setMenu] = useState<{ x: number; y: number; flowId: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rf = useReactFlow();

  const viewedId = project.view.viewedNodeId;
  const activeIds = useMemo(() => (viewedId && project.nodes.some((n) => n.id === viewedId) ? upstreamIds(project, viewedId) : new Set<string>()), [project, viewedId]);

  // Groups: a collapsed one hides its nodes behind one card; an open one draws a frame behind them.
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const collapsedOf = useMemo(() => {
    const m = new Map<string, NodeGroup>();
    for (const g of project.groups) if (g.collapsed) for (const id of g.nodeIds) m.set(id, g);
    return m;
  }, [project.groups]);

  const nodes: FlowNode[] = useMemo(() => {
    const ends = referenceEnds(project);
    const names = Object.fromEntries(project.nodes.map((n) => [n.id, n.name]));
    const at = (id: string) => dragging[id] ?? project.nodes.find((n) => n.id === id)?.position;
    const size = (id: string) => measured[id] ?? NODE_SIZE;
    const frames = project.groups
      .filter((g) => !g.collapsed)
      .map((g): GroupFrameFlowNode => {
        const box = frameBox(g, at, size);
        return { id: groupFrameId(g.id), type: 'frame', position: { x: box.x, y: box.y }, measured: measured[groupFrameId(g.id)], zIndex: -1, selectable: false, draggable: false, deletable: false, focusable: false, data: { group: g, width: box.width, height: box.height } };
      });
    const cards = project.groups
      .filter((g) => g.collapsed)
      .map((g): GroupFlowNode => {
        const id = groupCardId(g.id);
        const broken = g.nodeIds.filter((n) => statuses[n]?.status.state === 'error').length;
        return {
          id,
          type: 'group',
          position: dragging[id] ?? g.position,
          measured: measured[id],
          selected: selectedGroup === g.id,
          deletable: false,
          ariaLabel: `${g.name}, group of ${g.nodeIds.length} nodes${broken ? `, ${broken} broken` : ''}`,
          data: { group: g, ports: groupPorts(project, g), names, viewed: !!viewedId && g.nodeIds.includes(viewedId), broken },
        };
      });
    const visible = project.nodes.filter((n) => !collapsedOf.has(n.id));
    return [
      ...frames,
      ...visible.map((n): PuddleFlowNode => ({
        id: n.id,
        type: 'puddle',
        position: dragging[n.id] ?? n.position,
        measured: measured[n.id],
        selected: selectedNodeIds.includes(n.id),
        ariaLabel: nodeLabel(n, { detail: detailFor(n, project.sources, project.edges), status: statuses[n.id]?.status, viewed: n.id === viewedId }),
        className: n.id === connectFrom ? 'is-wiring-from' : undefined,
        data: { node: n, viewed: n.id === viewedId, detail: detailFor(n, project.sources, project.edges), refIn: ends.to.has(n.id), refOut: ends.from.has(n.id) },
      })),
      ...cards,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- references are read from project.nodes
  }, [project.nodes, project.sources, project.edges, project.groups, collapsedOf, dragging, measured, selectedNodeIds, selectedGroup, viewedId, statuses, connectFrom],
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
        // A wire into or out of a collapsed group goes to the group's card, at the socket for it.
        const fromGroup = collapsedOf.get(e.from.nodeId);
        const toGroup = collapsedOf.get(e.to.nodeId);
        return {
          id: e.id,
          type: 'wire',
          source: fromGroup ? groupCardId(fromGroup.id) : e.from.nodeId,
          sourceHandle: fromGroup ? outHandle(e.from.nodeId) : undefined,
          target: toGroup ? groupCardId(toGroup.id) : e.to.nodeId,
          targetHandle: toGroup ? inHandle(e.id) : String(e.to.port),
          hidden: !!fromGroup && fromGroup === toGroup,
          selected: selectedEdges.includes(e.id),
          ariaLabel: wireLabel(name(e.from.nodeId), name(e.to.nodeId), spec && portName(spec)),
          data: { state: broken ? 'broken' : active ? 'active' : 'idle', fromNodeId: e.from.nodeId, hovered: hoveredEdge === e.id, label: `${name(e.from.nodeId)}->${name(e.to.nodeId)}`, port: spec && String(spec.id), portName: spec && portName(spec) },
        };
      }),
      // A rule's reference to or from a node hidden in a group isn't drawn.
      ...referenceEdges(project).filter((e) => !collapsedOf.has(e.source) && !collapsedOf.has(e.target)),
    ],
    [project, statuses, activeIds, hoveredEdge, selectedEdges, collapsedOf],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const moving: Record<string, { x: number; y: number }> = {};
      const done: Record<string, { x: number; y: number }> = {};
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const c of changes) {
        if (c.type === 'dimensions' && c.dimensions) sizes[c.id] = c.dimensions;
        if (c.type === 'position' && c.position) (c.dragging ? moving : done)[c.id] = c.position;
        if (c.type === 'position' && !c.position && !c.dragging) {
          const g = groupIdOf(c.id);
          const pos = dragging[c.id] ?? (g ? groupById(project, g)?.position : project.nodes.find((n) => n.id === c.id)?.position);
          if (pos) done[c.id] = pos;
        }
      }
      if (Object.keys(sizes).length) setMeasured((m) => ({ ...m, ...sizes }));
      if (Object.keys(moving).length) setDragging((d) => ({ ...d, ...moving }));
      if (Object.keys(done).length) {
        // One undo step per drag, committed when the drag ends. A group's card moves the nodes inside with it.
        apply((p) =>
          Object.entries(done).reduce(
            (q, [id, pos]) => {
              const g = groupIdOf(id);
              return g ? moveGroup(q, g, pos) : moveNodes(q, { [id]: pos });
            },
            p,
          ),
        );
        setDragging((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !(id in done))));
      }
    },
    [apply, dragging, project],
  );

  // The input the wire was dropped on; the first free one when React Flow doesn't say.
  // From a collapsed group, the wire starts at the node behind the socket; into one, the group has to be opened first.
  const onConnect = useCallback((c: Connection) => {
    if (groupIdOf(c.target)) return useSession.getState().notify({ tone: 'info', text: 'Open the group to wire into a node inside it.' });
    const source = groupIdOf(c.source) && c.sourceHandle?.startsWith('out:') ? c.sourceHandle.slice(4) : c.source;
    if (wireNodes(source, c.target, parsePort(c.targetHandle))) useSession.getState().notify(null);
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
    if (selectedId) return focusNodeWhenDrawn(selectedId);
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
      <ReactFlow<FlowNode, PuddleEdge>
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
          if (n.type === 'frame') return;
          if (n.type === 'group') {
            useSession.getState().select(null);
            return setSelectedGroup(n.data.group.id);
          }
          setSelectedGroup(null);
          if (e.shiftKey || e.metaKey || e.ctrlKey) return useSession.getState().toggleSelected(n.id);
          useSession.getState().select(n.id);
          viewNode(n.id);
        }}
        onNodeDoubleClick={(_e, n) => {
          // A group opens, as Tab opens one in Blender.
          if (n.type === 'group') return apply((p) => setGroupCollapsed(p, n.data.group.id, false));
          if (n.type !== 'puddle') return;
          if (n.data.node.type === 'transform') apply((p) => setCollapsed(p, n.id, n.data.node.collapsed !== false));
          // A Query opens in its designer, as a query does in Access.
          if (n.data.node.type === 'query') useSession.getState().openDesigner(n.id);
        }}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, flowId: n.id });
        }}
        onPaneClick={() => {
          setSelectedGroup(null);
          useSession.getState().select(null);
        }}
        onDelete={({ nodes: delNodes, edges: delEdges }) => {
          // One undo step for the whole deletion, nodes and wires together. A group's card isn't deleted this way.
          const ids = delNodes.filter((n) => n.type === 'puddle').map((n) => n.id);
          apply((p) => removeNodes({ ...p, edges: p.edges.filter((e) => !delEdges.some((d) => d.id === e.id)) }, ids));
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
        {minimapNeeded && <MiniMap pannable zoomable ariaLabel="Minimap" />}
        <Controls showInteractive={false}>
          <ControlButton onClick={onLayout} disabled={!project.nodes.length} aria-label="Auto layout" title={withShortcut('Auto layout', 'layout')}>
            <Icon name="layout" size={12} />
          </ControlButton>
        </Controls>
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

      {selectedNodeIds.length > 1 && <GroupBar ids={selectedNodeIds} onGrouped={setSelectedGroup} />}
      {menu && <NodeMenu at={menu} onClose={() => setMenu(null)} onRename={setRenaming} onGrouped={setSelectedGroup} />}
      {renaming && <RenameGroup groupId={renaming} onClose={() => setRenaming(null)} />}

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
