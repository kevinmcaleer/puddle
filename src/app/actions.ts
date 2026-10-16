import { autoLayout } from '../canvas/layout';
import { addNode, nodeById, useProjectStore, type Source, type SourceFormat } from '../model';
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

/** Add a Transform or Output node to the right of the selected node, wired to it. */
export function addNodeAfterSelection(type: 'transform' | 'output') {
  const { apply, history } = useProjectStore.getState();
  const selected = useSession.getState().selectedNodeId;
  const after = selected ? nodeById(history.present, selected) : undefined;
  const nodes = history.present.nodes;
  // Right of the selection, or right of everything when nothing is selected, so new nodes never stack.
  const position = after
    ? { x: after.position.x + 296, y: after.position.y }
    : nodes.length
      ? { x: Math.max(...nodes.map((n) => n.position.x)) + 296, y: Math.min(...nodes.map((n) => n.position.y)) }
      : { x: 80, y: 80 };
  let added: string | undefined;
  apply((p) => {
    const next = addNode(p, type, position, after?.id);
    added = next.nodes[next.nodes.length - 1]!.id;
    return next;
  });
  if (added) useSession.getState().select(added);
}

export const layoutFlow = () => useProjectStore.getState().apply(autoLayout);
