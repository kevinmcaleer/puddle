// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseDbml } from '../parse';
import { exportBounds, jpegPdf, serializeSvg, type StyleReader } from './exportImage';
import { layoutDiagram } from './geometry';

const NS = 'http://www.w3.org/2000/svg';
const el = (name: string, attrs: Record<string, string> = {}, ...kids: Element[]) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  kids.forEach((k) => e.append(k));
  return e;
};

// Stands in for getComputedStyle: the theme's colours, already resolved from the tokens.
const THEME: Record<string, Record<string, string>> = {
  'puddle-schema-table__box': { fill: 'rgb(255, 255, 255)', stroke: 'rgb(208, 213, 221)', 'stroke-width': '1px' },
  'puddle-schema-table__name': { fill: 'rgb(16, 24, 40)', 'font-family': 'Inter, system-ui, sans-serif', 'font-size': '13px', 'font-weight': '600' },
  'puddle-schema-ref__line': { fill: 'none', stroke: 'rgb(22, 160, 133)' },
  hidden: { display: 'none' },
};
const read: StyleReader = (e) => ({ getPropertyValue: (p) => [...e.classList].map((c) => THEME[c]?.[p]).find(Boolean) ?? '' });

const drawing = () =>
  el(
    'svg',
    { class: 'puddle-schema-svg', 'data-testid': 'schema-diagram', role: 'group', 'aria-label': 'Schema diagram', tabindex: '0' },
    el(
      'g',
      { transform: 'translate(40,20) scale(1.5)' },
      el('g', { class: 'puddle-schema-ref', 'data-pairs': 'a=b' }, el('path', { class: 'puddle-schema-ref__hit', d: 'M0,0 L1,1' }), el('path', { class: 'puddle-schema-ref__line', d: 'M0,0 L1,1' })),
      el('g', { class: 'puddle-schema-table', tabindex: '0', 'aria-label': 'Table users' }, el('rect', { class: 'puddle-schema-table__box', width: '200', height: '84' }), el('text', { class: 'puddle-schema-table__name' })),
      el('g', { class: 'hidden' }, el('rect', {})),
    ),
  ) as unknown as SVGSVGElement;

describe('the diagram as a standalone SVG', () => {
  it('writes the theme’s resolved colours and fonts onto each element, and drops what is only for pointing and reading out', () => {
    const svg = drawing();
    svg.querySelector('text')!.textContent = 'users';
    const out = serializeSvg(svg, { x: 0, y: 0, w: 300, h: 120 }, { read });
    expect(out).toContain('<rect width="200" height="84" style="fill:rgb(255, 255, 255);stroke:rgb(208, 213, 221);stroke-width:1px"/>');
    expect(out).toContain('<text style="fill:rgb(16, 24, 40);font-family:Inter, system-ui, sans-serif;font-size:13px;font-weight:600">users</text>');
    expect(out).toContain('style="fill:none;stroke:rgb(22, 160, 133)"');
    for (const gone of ['class=', 'data-', 'aria-', 'tabindex', 'role=', 'transform', 'puddle-schema-ref__hit']) expect(out).not.toContain(gone);
    expect(out.match(/<path/g)).toHaveLength(1);
    expect(out.match(/<rect/g)).toHaveLength(1);
    // The original on screen is left as it was.
    expect(svg.querySelector('g')!.getAttribute('transform')).toBe('translate(40,20) scale(1.5)');
  });

  it('crops to the bounds, and puts a background behind when asked', () => {
    const out = serializeSvg(drawing(), { x: 10, y: 20, w: 300.5, h: 120 }, { read, background: 'rgb(0, 0, 0)' });
    expect(out).toMatch(/<svg [^>]*viewBox="10 20 300.5 120"/);
    expect(out).toMatch(/<svg [^>]*width="301" height="120"/);
    expect(out).toMatch(/<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(out).toContain('<rect x="10" y="20" width="300.5" height="120" fill="rgb(0, 0, 0)"/>');
  });
});

describe('what is exported', () => {
  const schema = parseDbml('Table a {\n  id int\n}\nTable b {\n  id int\n}').schema;
  const diagram = layoutDiagram(schema, { 'table:public.a': { x: 100, y: 100 }, 'table:public.b': { x: 600, y: 400 } });
  it('is everything drawn, or only the selected tables with a margin around them', () => {
    expect(exportBounds(diagram)).toEqual(diagram.bounds);
    const a = diagram.tables.find((t) => t.id === 'table:public.a')!;
    expect(exportBounds(diagram, ['table:public.a'])).toEqual({ x: 84, y: 84, w: a.w + 32, h: a.h + 32 });
    expect(exportBounds(diagram, ['table:public.gone'])).toEqual(diagram.bounds);
  });
});

describe('the PDF', () => {
  it('is one page the size of the picture, holding the JPEG, with a cross-reference table that points at each object', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = jpegPdf(jpeg, { w: 600, h: 400 }, { w: 300, h: 200 });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 300 200]');
    expect(text).toContain('/Width 600 /Height 400');
    expect(text).toContain('/Filter /DCTDecode /Length 7');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    // Offsets count bytes; the binary comment and the JPEG are bytes, so read them from the bytes.
    offsets.forEach((o, i) => expect(new TextDecoder().decode(pdf.slice(o, o + 8))).toBe(`${i + 1} 0 obj\n`));
  });
});
