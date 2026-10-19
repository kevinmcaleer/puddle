// The diagram as a picture: the SVG on screen made standalone (its styles written onto each element, so the colours
// are the theme's and nothing depends on Puddle's stylesheet), cropped to what is exported; then a PNG drawn from it,
// and a one-page PDF holding that picture. All in the browser.
import type { Diagram } from './geometry';
import type { Rect } from './place';

/** The style properties an exported element keeps: what the stylesheet sets on the diagram's shapes and text. */
export const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
] as const;

/** Reads an element's computed style; `getComputedStyle` in the browser. */
export type StyleReader = (el: Element) => { getPropertyValue: (name: string) => string };

/** Shapes that are only there to be pointed at or typed in, never drawn. */
const UI_ONLY = ['puddle-schema-ref__hit', 'puddle-schema-linking'];

/** The area to export: the selected tables when there are any, else everything drawn; with a margin. */
export function exportBounds(diagram: Diagram, selected: string[] = [], margin = 16): Rect {
  const boxes = diagram.tables.filter((t) => selected.includes(t.id));
  if (!boxes.length) return diagram.bounds;
  const x = Math.min(...boxes.map((b) => b.x)) - margin;
  const y = Math.min(...boxes.map((b) => b.y)) - margin;
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) + margin - x, h: Math.max(...boxes.map((b) => b.y + b.h)) + margin - y };
}

/**
 * A standalone SVG of the diagram: every element's style written onto it from `read`, the pan and zoom taken off,
 * cropped to `bounds`, with a background when one is given. Text stays text.
 */
export function serializeSvg(svg: SVGSVGElement, bounds: Rect, { read, background }: { read: StyleReader; background?: string }): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const walk = (from: Element, to: Element) => {
    const style = read(from);
    if (style.getPropertyValue('display') === 'none' || UI_ONLY.some((c) => from.classList.contains(c))) {
      to.remove();
      return;
    }
    if (from !== svg) {
      const own = STYLE_PROPS.map((p) => [p, style.getPropertyValue(p).trim()] as const).filter(([, v]) => v && v !== 'normal' && v !== 'auto');
      if (own.length) to.setAttribute('style', own.map(([p, v]) => `${p}:${v}`).join(';'));
    }
    for (const a of [...to.attributes]) if (a.name === 'class' || a.name === 'tabindex' || a.name === 'role' || a.name.startsWith('aria-') || a.name.startsWith('data-')) to.removeAttribute(a.name);
    const kids = [...from.children];
    const copies = [...to.children];
    kids.forEach((k, i) => walk(k, copies[i]!));
  };
  walk(svg, copy);
  // The drawing's own group carries the screen's pan and zoom; the viewBox does that job now.
  copy.querySelector(':scope > g')?.removeAttribute('transform');
  for (const a of ['style', 'width', 'height']) copy.removeAttribute(a);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
  copy.setAttribute('width', String(Math.ceil(bounds.w)));
  copy.setAttribute('height', String(Math.ceil(bounds.h)));
  if (background) {
    const rect = copy.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [k, v] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, fill: background })) rect.setAttribute(k, String(v));
    copy.insertBefore(rect, copy.firstChild);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}\n`;
}

/** Draw an SVG onto a canvas at a scale, over a background or transparent. */
export async function svgToCanvas(svgText: string, size: { w: number; h: number }, scale: number, background?: string): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(size.w * scale);
    canvas.height = Math.ceil(size.h * scale);
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const canvasBlob = (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser couldn’t make the image.'))), type, quality));

/**
 * A one-page PDF holding a JPEG, the page sized to the picture (`w` by `h` points, a point per CSS pixel at 1x). Written
 * by hand: one image, one page, so no PDF library is needed.
 */
export function jpegPdf(jpeg: Uint8Array, pixels: { w: number; h: number }, page: { w: number; h: number }): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: Uint8Array | string) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };
  const [pw, ph] = [page.w, page.h].map((v) => Math.round(v * 100) / 100);
  const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  object(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  object(4, [`<< /Type /XObject /Subtype /Image /Width ${pixels.w} /Height ${pixels.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  object(5, [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Classes that show what is hovered, found, selected or moving on screen; a picture is drawn without them. */
const STATES = ['is-dim', 'is-found', 'is-current', 'is-selected', 'is-moving'];

/**
 * The SVG on screen as a standalone picture in a theme: the on-screen highlights taken off and the theme pinned while
 * the styles are read, then both put back as they were. The background is the canvas colour, or none when transparent.
 */
export function pictureOf(svg: SVGSVGElement, bounds: Rect, { theme, transparent }: { theme: 'light' | 'dark'; transparent: boolean }): { svg: string; background: string } {
  const root = document.documentElement;
  const before = root.getAttribute('data-theme');
  const lit = [...svg.querySelectorAll(STATES.map((c) => `.${c}`).join(','))].map((e) => [e, STATES.filter((c) => e.classList.contains(c))] as const);
  const focused = svg.contains(document.activeElement) ? (document.activeElement as HTMLElement | SVGElement) : null;
  try {
    lit.forEach(([e, cs]) => e.classList.remove(...cs));
    focused?.blur();
    root.setAttribute('data-theme', theme);
    const background = getComputedStyle(root).getPropertyValue('--surface-canvas').trim() || (theme === 'dark' ? '#000' : '#fff');
    return { svg: serializeSvg(svg, bounds, { read: (e) => getComputedStyle(e), background: transparent ? undefined : background }), background };
  } finally {
    if (before == null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', before);
    lit.forEach(([e, cs]) => e.classList.add(...cs));
  }
}
