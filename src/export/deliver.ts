// Handing an export to the person: a download, or the clipboard.

/** Download a Blob as a file. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const NO_CLIPBOARD = 'This browser won’t let Puddle use the clipboard. Export a file instead.';

type Clip = Pick<Clipboard, 'writeText'> & Partial<Pick<Clipboard, 'write'>>;
type ItemConstructor = new (items: Record<string, Promise<Blob> | Blob>) => ClipboardItem;

export async function copyText(text: string, clip: Clip | undefined = navigator.clipboard) {
  if (!clip?.writeText) throw new Error(NO_CLIPBOARD);
  try {
    await clip.writeText(text);
  } catch {
    // Browsers refuse with a terse NotAllowedError; say what to do instead.
    throw new Error(NO_CLIPBOARD);
  }
}

/** A clipboard write started during the click, filled in once the export has run. */
export interface ClipboardSlot {
  fill(text: string): Promise<void>;
  /** The export failed or stopped: nothing is written. */
  cancel(): void;
}

/**
 * Safari, and Firefox after a few seconds, only let a page write to the clipboard while handling the click
 * that asked for it, and an export takes longer than that. So the write starts during the click, with its
 * text still to come: a ClipboardItem holding a promise, which the browser keeps the right to fill. Where
 * that isn't supported (no ClipboardItem), this is undefined, and the text is written when it's ready.
 */
export function reserveClipboard(
  clip: Clip | undefined = globalThis.navigator?.clipboard,
  Item: ItemConstructor | undefined = (globalThis as { ClipboardItem?: ItemConstructor }).ClipboardItem,
): ClipboardSlot | undefined {
  if (!clip?.write || typeof Item !== 'function') return undefined;
  let resolve!: (blob: Blob) => void;
  let reject!: (e: Error) => void;
  const blob = new Promise<Blob>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let written: Promise<void>;
  try {
    written = clip.write([new Item({ 'text/plain': blob })]);
  } catch {
    return undefined;
  }
  // A cancelled slot rejects its write; that is expected, not an error to report.
  const settled = written.then(
    () => true,
    () => false,
  );
  return {
    async fill(text) {
      resolve(new Blob([text], { type: 'text/plain' }));
      // If the browser turned the early write down, try the plain way: it works where no click is needed.
      if (!(await settled)) await copyText(text, clip);
    },
    cancel() {
      reject(new Error('The export didn’t finish.'));
    },
  };
}
