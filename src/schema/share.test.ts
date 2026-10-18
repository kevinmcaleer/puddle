import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SchemaView } from '../model/schema';
import { decodeShare, embedSnippet, encodeShare, readShareHash, SHARE_LIMIT, shareNotice, shareSize, shareUrl } from './share';

const shop = readFileSync('tests/fixtures/dbml/shop.dbml', 'utf8');
const view: SchemaView = { id: 'v1', name: 'Sales', tables: ['table:public.orders', 'table:public.order_items'], positions: { 'table:public.orders': { x: 10, y: 20.5 } }, detail: 'keys', zoom: { x: 1, y: -2, k: 0.75 } };

/** Text that compresses badly: a seeded pseudo-random sequence of words, so it's the same every run. */
function noisy(bytes: number): string {
  let seed = 42;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
  let out = '';
  while (out.length < bytes) out += `Table t${next()} {\n  c${next().toString(36)} int\n}\n`;
  return out;
}

describe('share links', () => {
  it('round-trips the DBML, and the views when there are any', async () => {
    const text = await encodeShare({ dbml: shop });
    expect(text).toMatch(/^1[A-Za-z0-9_-]+$/);
    expect(await decodeShare(text)).toEqual({ dbml: shop });
    expect(await decodeShare(await encodeShare({ dbml: shop, views: [view] }))).toEqual({ dbml: shop, views: [view] });
    expect(await decodeShare(await encodeShare({ dbml: shop, views: [] }))).toEqual({ dbml: shop });
    expect(await decodeShare(await encodeShare({ dbml: '' }))).toEqual({ dbml: '' });
  });

  it('keeps every character: accents, other scripts, emoji and quotes', async () => {
    const dbml = "Table café {\n  名前 text [note: 'Ünïcødé \u{1F4B8} \"quoted\" \\\\ back']\n}\n";
    expect((await decodeShare(await encodeShare({ dbml }))).dbml).toBe(dbml);
  });

  it('compresses, and round-trips a large schema', async () => {
    const repeated = Array.from({ length: 400 }, (_, i) => `Table t${i} {\n  id int [pk]\n  name varchar\n}\n`).join('\n');
    const small = await encodeShare({ dbml: repeated });
    expect(small.length).toBeLessThan(repeated.length / 4);
    const big = noisy(300_000);
    expect((await decodeShare(await encodeShare({ dbml: big }))).dbml).toBe(big);
  });

  it('turns away text that is not a share link, with a message that says so', async () => {
    const good = await encodeShare({ dbml: shop });
    const broken = /broken or incomplete/;
    await expect(decodeShare('')).rejects.toThrow(broken);
    await expect(decodeShare('hello world')).rejects.toThrow(broken);
    await expect(decodeShare(good.slice(1))).rejects.toThrow(broken);
    await expect(decodeShare(good.slice(0, good.length / 2))).rejects.toThrow(broken);
    await expect(decodeShare(`${good}!`)).rejects.toThrow(broken);
    await expect(decodeShare('1' + 'A'.repeat(41))).rejects.toThrow(broken);
    // Valid compression of the wrong shape.
    const wrong = await encodeShare({ dbml: 1 as unknown as string });
    await expect(decodeShare(wrong)).rejects.toThrow(broken);
    const badView = await encodeShare({ dbml: 'x', views: [{ ...view, zoom: { x: 'no' } } as unknown as SchemaView] });
    await expect(decodeShare(badView)).rejects.toThrow(broken);
  });

  it('asks for a reload when the link is from a newer Puddle', async () => {
    const good = await encodeShare({ dbml: shop });
    await expect(decodeShare(`2${good.slice(1)}`)).rejects.toThrow('newer version of Puddle');
  });

  it('puts the schema in the fragment, replacing any there, and reads it back with and without embed', () => {
    expect(shareUrl('https://puddle.example/app/', '1abc')).toBe('https://puddle.example/app/#schema=1abc');
    expect(shareUrl('https://puddle.example/app/#schema=1old&embed=1', '1abc', { embed: true })).toBe('https://puddle.example/app/#schema=1abc&embed=1');
    expect(readShareHash('#schema=1abc')).toEqual({ encoded: '1abc', embed: false });
    expect(readShareHash('#schema=1a-b_c&embed=1')).toEqual({ encoded: '1a-b_c', embed: true });
    expect(readShareHash('embed=1&schema=1abc')).toEqual({ encoded: '1abc', embed: true });
    expect(readShareHash('#schema=1abc&embed=0')).toEqual({ encoded: '1abc', embed: false });
    expect(readShareHash('')).toBeNull();
    expect(readShareHash('#')).toBeNull();
    expect(readShareHash('#schema=')).toBeNull();
    expect(readShareHash('#section-2')).toBeNull();
  });

  it('round-trips through a real URL', async () => {
    const encoded = await encodeShare({ dbml: shop, views: [view] });
    const url = new URL(shareUrl('https://puddle.example/', encoded, { embed: true }));
    const read = readShareHash(url.hash)!;
    expect(read.embed).toBe(true);
    expect(await decodeShare(read.encoded)).toEqual({ dbml: shop, views: [view] });
  });

  it('says how long the link is, and when it is too long to share', async () => {
    const url = shareUrl('https://puddle.example/', await encodeShare({ dbml: shop }));
    expect(shareSize(url)).toBe(url.length);
    expect(shareSize('https://x/#ü')).toBe(13);
    const under = shareNotice(url);
    expect(under.tooLong).toBe(false);
    expect(under.message).toMatch(/^This link is \d+(\.\d)? KB\. It carries the schema itself, so the server never sees it/);

    const long = shareUrl('https://puddle.example/', await encodeShare({ dbml: noisy(150_000) }));
    expect(shareSize(long)).toBeGreaterThan(SHARE_LIMIT);
    const over = shareNotice(long);
    expect(over.tooLong).toBe(true);
    expect(over.message).toMatch(/^This link is \d+(\.\d)? KB, longer than the 32 KB that browsers and chat apps reliably keep\. Share the schema as a file instead/);
    expect(shareNotice('x'.repeat(SHARE_LIMIT)).tooLong).toBe(false);
    expect(shareNotice('x'.repeat(SHARE_LIMIT + 1)).tooLong).toBe(true);
  });

  it('writes an iframe snippet with the link and title escaped', () => {
    const snippet = embedSnippet('https://puddle.example/#schema=1abc&embed=1');
    expect(snippet).toBe('<iframe src="https://puddle.example/#schema=1abc&amp;embed=1" title="Schema diagram" width="100%" height="600" style="border: 0" loading="lazy"></iframe>');
    const hostile = embedSnippet('https://x/"><script>alert(1)</script>', 'A "shop" <diagram>');
    expect(hostile).not.toContain('<script>');
    expect(hostile).toContain('src="https://x/&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(hostile).toContain('title="A &quot;shop&quot; &lt;diagram&gt;"');
  });

  it('carries the diagram as laid out, and leaves out what is empty or the default', async () => {
    const payload = { dbml: 'Table a {\n  id int\n}', positions: { 'table:public.a': { x: 10, y: 20 } }, detail: 'keys' as const };
    expect(await decodeShare(await encodeShare(payload))).toEqual(payload);
    expect(await decodeShare(await encodeShare({ dbml: 'x', positions: {}, detail: 'full', views: [] }))).toEqual({ dbml: 'x' });
  });
});
