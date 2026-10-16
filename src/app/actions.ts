import { autoLayout } from '../canvas/layout';
import { neighbour, type Direction } from '../canvas/navigate';
import { suggestJoinKey, suggestLookupColumns } from '../compiler';
import { useFlowStore } from '../flow/status';
import { addNode, canGroup, groupNodes, inputEdges, moveQueryTable, nodeById, setJoinSpec, setLookupSpec, useProjectStore, type AddableNodeType, type ColumnSchema, type Project, type Source, type SourceFormat } from '../model';
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
  const several = selectedNodeIds.length > 1 && (type === 'join' || type === 'append' || type === 'lookup' || type === 'query');
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
