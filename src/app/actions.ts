import { autoLayout } from '../canvas/layout';
import { neighbour, type Direction } from '../canvas/navigate';
import { suggestJoinKey, suggestLookupColumns } from '../compiler';
import { useFlowStore } from '../flow/status';
import { addNode, canConnect, canGroup, connect, disconnect, freePort, groupNodes, inputEdges, moveQueryTable, newId, nodeById, setJoinSpec, setLookupSpec, useProjectStore, type AddableNodeType, type ColumnSchema, type Port, type Project, type Source, type SourceFormat } from '../model';
import { addClipboardSource, addFileSource } from '../sources/add';
import { pickFiles, type PickedFile } from '../sources/handles';
import { addUrlSource } from '../sources/url';
import { useSession } from './session';

const report = (e: unknown) => useSession.getState().notify({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });

/** Where the next source goes: below the lowest source already on the canvas. */
function nextSourcePosition() {
  const sources = useProjectStore.getState().history.present.nodes.filter((n) => n.type === 'source');
  if (!sources.length) return { x: 80, y: 80 };
  return { x: Math.min(...sources.map((n) => n.position.x)), y: Math.max(...sources.map((n) => n.position.y)) + 128 };
}

/** Select the node reading a newly added source, so the inspector shows its read options. */
function selectSource(source: Source) {
  const node = useProjectStore.getState().history.present.nodes.find((n) => n.type === 'source' && n.sourceId === source.id);
  useSession.getState().select(node?.id ?? null);
  useSession.getState().notify(null);
}

/** Add files as sources: at `at` (a drop point) stacked downwards, or below the existing sources. */
export async function addFiles(files: Iterable<File | PickedFile>, at?: { x: number; y: number }) {
  let i = 0;
  for (const item of files) {
    const { file, handle } = item instanceof File ? { file: item, handle: undefined } : item;
    try {
      selectSource(await addFileSource(file, at ? { x: at.x, y: at.y + i++ * 128 } : nextSourcePosition(), handle));
    } catch (e) {
      report(e);
    }
  }
}

/**
 * "Choose files": the browser's file picker where it keeps handles (Chromium), so the files reconnect with a click
 * next time; otherwise `fallback` opens the usual file input.
 */
export async function chooseFiles(fallback: () => void) {
  const picked = await pickFiles(true);
  if (picked === null) fallback();
  else await addFiles(picked);
}

export async function addPastedText(text: string) {
  try {
    selectSource(await addClipboardSource(text, nextSourcePosition()));
  } catch (e) {
    report(e);
  }
}

/** Add a source from a web address, below the existing sources. Throws, in plain words, when it can't be read. */
export async function addUrl(address: string, format?: SourceFormat) {
  selectSource(await addUrlSource(address, { format, position: nextSourcePosition() }));
}

/** Read the clipboard (asks for permission the first time) and add it as a source. */
export async function pasteFromClipboard() {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    useSession.getState().notify({ tone: 'info', text: 'Puddle can’t read the clipboard here. Press Ctrl+V (Cmd+V on a Mac) on the canvas instead.' });
    return;
  }
  await addPastedText(text);
}

const NO_COLUMNS: ColumnSchema[] = [];
const columnsOf = (nodeId: string) => {
  const status = useFlowStore.getState().nodes[nodeId]?.status;
  return status?.state === 'ok' ? status.columns : NO_COLUMNS;
};

/** Where a new node fed by these nodes goes: right of them (level with them), or right of everything when there are none, so new nodes never stack. */
export function positionAfter(project: Project, feeds: string[]) {
  const nodes = project.nodes;
  const inputs = feeds.flatMap((id) => nodeById(project, id) ?? []);
  return inputs.length
    ? { x: Math.max(...inputs.map((n) => n.position.x)) + 296, y: Math.round(inputs.reduce((y, n) => y + n.position.y, 0) / inputs.length) }
    : nodes.length
      ? { x: Math.max(...nodes.map((n) => n.position.x)) + 296, y: Math.min(...nodes.map((n) => n.position.y)) }
      : { x: 80, y: 80 };
}

/**
 * Add a node to the right of the selected node, wired to it. A Join takes the first two selected nodes, in
 * the order they were selected, as its left and right inputs, matched on a column they share when there is one;
 * a Lookup takes them as its main and lookup inputs the same way; an Append takes every selected node as its
 * inputs 1, 2, 3 in that order, and so does a Query, as its tables. A new Query opens in the query designer.
 */
export function addNodeAfterSelection(type: AddableNodeType) {
  const { apply, history } = useProjectStore.getState();
  const { selectedNodeId: selected, selectedNodeIds } = useSession.getState();
  const after = selected ? nodeById(history.present, selected) : undefined;
  const several = selectedNodeIds.length > 1 && (type === 'join' || type === 'append' || type === 'lookup' || type === 'query' || type === 'sql');
  const feeds = several ? (type === 'join' || type === 'lookup' ? selectedNodeIds.slice(0, 2) : selectedNodeIds) : after?.id;
  const position = positionAfter(history.present, Array.isArray(feeds) ? feeds : after ? [after.id] : []);
  let added: string | undefined;
  apply((p) => {
    let next = addNode(p, type, position, feeds);
    added = next.nodes[next.nodes.length - 1]!.id;
    // A Join wired to two nodes starts matching on a column they share, such as customer_id.
    const pair = Array.isArray(feeds) && feeds.length === 2 ? ([columnsOf(feeds[0]!), columnsOf(feeds[1]!)] as const) : undefined;
    const key = pair && (type === 'join' || type === 'lookup') ? suggestJoinKey(...pair) : undefined;
    if (key && type === 'join') next = setJoinSpec(next, added, { keys: [key] });
    // A Lookup also starts bringing across the lookup's other columns that the main input doesn't have yet.
    if (key && type === 'lookup') next = setLookupSpec(next, added, { keys: [{ main: key.left, lookup: key.right }], columns: suggestLookupColumns(pair![0], pair![1], key.right) });
    // A Query's tables start side by side in the designer, in input order.
    if (type === 'query') for (const [i, e] of inputEdges(next, added).entries()) next = moveQueryTable(next, added, e.to.port as number, { x: 24 + i * 264, y: 24 });
    return next;
  });
  if (!added) return;
  if (type === 'query') useSession.getState().openDesigner(added);
  else useSession.getState().select(added);
}

export const layoutFlow = () => useProjectStore.getState().apply(autoLayout);

/** Group the selected nodes into one, or say why they can't be. */
export function groupSelection() {
  const { selectedNodeIds, notify, select } = useSession.getState();
  if (selectedNodeIds.length < 2) return notify({ tone: 'info', text: 'Select two or more Transform nodes in a line to group them (Shift+click adds to the selection).' });
  const check = canGroup(useProjectStore.getState().history.present, selectedNodeIds);
  if (!check.ok) return notify({ tone: 'warn', text: check.reason });
  useProjectStore.getState().apply((p) => groupNodes(p, selectedNodeIds));
  select(check.chain[0]!);
}

/** Move the selection along the wires (the arrow keys). Selecting doesn't view; V does. Not while the Query designer covers the canvas. */
export function selectNeighbour(direction: Direction) {
  if (useSession.getState().designerNodeId) return;
  const project = useProjectStore.getState().history.present;
  const next = neighbour(project, useSession.getState().selectedNodeId, direction);
  if (next) useSession.getState().select(next.id);
}

/** Show the selected node in the results table. */
export function viewSelected() {
  const id = useSession.getState().selectedNodeId;
  if (id && nodeById(useProjectStore.getState().history.present, id)) useProjectStore.getState().setView({ viewedNodeId: id, viewedStepIndex: undefined });
}

/** Open the inspector's Add step menu with its search focused, for a selected Transform node. */
export function searchAddStep() {
  const id = useSession.getState().selectedNodeId;
  const node = id ? nodeById(useProjectStore.getState().history.present, id) : undefined;
  if (node?.type !== 'transform') return useSession.getState().notify({ tone: 'info', text: 'Select a Transform node to add a step to it.' });
  useSession.getState().requestAddStep();
}

/**
 * Wire one node's output into another's input: `port` when the wire was dropped on one, else the first free input.
 * When it can't be wired, the canvas notice says why. True when the wire was added.
 */
export function wireNodes(fromId: string, toId: string, port?: Port): boolean {
  const { apply, history } = useProjectStore.getState();
  const into = port ?? freePort(history.present, toId);
  const check = canConnect(history.present, fromId, toId, into);
  if (!check.ok || into == null) {
    useSession.getState().notify({ tone: 'warn', text: check.ok ? 'That node has no free input.' : check.reason });
    return false;
  }
  apply((p) => connect(p, { id: newId('e'), from: { nodeId: fromId }, to: { nodeId: toId, port: into } }));
  return true;
}

const nameOf = (id: string) => nodeById(useProjectStore.getState().history.present, id)?.name ?? id;

/**
 * C: start wiring from the selected node. The next node chosen with Enter (or C again) is wired from it, or, when a
 * wire already runs between them, unwired. Escape cancels.
 */
export function startWiring() {
  const { selectedNodeId, connectFrom, notify, setConnectFrom } = useSession.getState();
  if (connectFrom) return finishWiring();
  if (!selectedNodeId) return notify({ tone: 'info', text: 'Select a node to wire from first.' });
  setConnectFrom(selectedNodeId);
  notify({ tone: 'info', text: `Wiring from ${nameOf(selectedNodeId)}. Move to the node to wire it into and press Enter, or Escape to cancel. Choosing a node it already feeds removes that wire.` });
}

/** Wire the node being wired from into the selected node, or take away the wire between them. */
export function finishWiring() {
  const { selectedNodeId: to, connectFrom: from, notify, setConnectFrom } = useSession.getState();
  if (!from) return;
  if (!to || to === from) return notify({ tone: 'info', text: `Wiring from ${nameOf(from)}. Move to another node first, or press Escape to cancel.` });
  setConnectFrom(null);
  const { apply, history } = useProjectStore.getState();
  const existing = inputEdges(history.present, to).find((e) => e.from.nodeId === from);
  if (existing) {
    apply((p) => disconnect(p, existing.id));
    return notify({ tone: 'info', text: `Removed the wire from ${nameOf(from)} into ${nameOf(to)}.` });
  }
  if (wireNodes(from, to)) notify({ tone: 'info', text: `Wired ${nameOf(from)} into ${nameOf(to)}.` });
}

/** Escape: stop wiring. False when there was nothing to cancel, so Escape keeps its usual meaning. */
export function cancelWiring(): boolean {
  const { connectFrom, notify, setConnectFrom } = useSession.getState();
  if (!connectFrom) return false;
  setConnectFrom(null);
  notify({ tone: 'info', text: 'Wiring cancelled.' });
  return true;
}

/**
 * Enter on the canvas: finish wiring when wiring, otherwise open the selected node: a Query in its designer, any
 * other node in the inspector, with the keyboard moved there.
 */
export function openSelected(focusInspector: () => void) {
  const { selectedNodeId, connectFrom, openDesigner, setInspectorTab } = useSession.getState();
  if (connectFrom) return finishWiring();
  const node = selectedNodeId ? nodeById(useProjectStore.getState().history.present, selectedNodeId) : undefined;
  if (!node) return;
  if (node.type === 'query') return openDesigner(node.id);
  setInspectorTab('node');
  focusInspector();
}
