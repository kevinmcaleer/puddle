import { describe, expect, it, vi } from 'vitest';
import { copyText, reserveClipboard } from './deliver';

/** A ClipboardItem stand-in that keeps what it was given. */
class Item {
  constructor(readonly items: Record<string, Promise<Blob> | Blob>) {}
}

/** A clipboard whose write waits for the item's text, as browsers do, and records it. */
function clipboard({ refuse = false } = {}) {
  const written: string[] = [];
  return {
    written,
    writeText: vi.fn(async (t: string) => void written.push(`text:${t}`)),
    write: vi.fn(async (items: Item[]) => {
      const blob = await items[0]!.items['text/plain'];
      if (refuse) throw new DOMException('Not allowed', 'NotAllowedError');
      written.push(`item:${await blob!.text()}`);
    }),
  };
}

const as = <T>(v: unknown) => v as T;

describe('the clipboard reserved at the click', () => {
  it('starts the write straight away, then fills it with the export', async () => {
    const clip = clipboard();
    const slot = reserveClipboard(as(clip), as(Item))!;
    // The write was asked for during the click, before the export ran.
    expect(clip.write).toHaveBeenCalledTimes(1);
    expect(clip.written).toEqual([]);
    await slot.fill('id\tname');
    expect(clip.written).toEqual(['item:id\tname']);
    expect(clip.writeText).not.toHaveBeenCalled();
  });

  it('writes nothing when the export fails, and reports nothing either', async () => {
    const clip = clipboard();
    const slot = reserveClipboard(as(clip), as(Item))!;
    slot.cancel();
    await new Promise((r) => setTimeout(r, 0));
    expect(clip.written).toEqual([]);
  });

  it('falls back to writing the text when the browser turns the early write down', async () => {
    const clip = clipboard({ refuse: true });
    await reserveClipboard(as(clip), as(Item))!.fill('a\tb');
    expect(clip.written).toEqual(['text:a\tb']);
  });

  it('is not used where ClipboardItem or clipboard.write is missing', async () => {
    expect(reserveClipboard(as(clipboard()), undefined)).toBeUndefined();
    expect(reserveClipboard(as({ writeText: vi.fn() }), as(Item))).toBeUndefined();
    expect(reserveClipboard(undefined, as(Item))).toBeUndefined();
  });

  it('says plainly when there is no clipboard at all', async () => {
    await expect(copyText('x', undefined)).rejects.toThrow('This browser won’t let Puddle use the clipboard. Export a file instead.');
  });

  it('says the same plainly when the browser refuses both ways', async () => {
    const clip = clipboard({ refuse: true });
    clip.writeText.mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    await expect(reserveClipboard(as(clip), as(Item))!.fill('a')).rejects.toThrow('This browser won’t let Puddle use the clipboard. Export a file instead.');
  });
});
