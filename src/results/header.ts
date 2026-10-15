import type { DrawHeaderCallback } from '@glideapps/glide-data-grid';
import type { ColumnKind, Quality } from '../ui';

/** Short labels drawn in the header's type tag; the design system's TypeTag uses the same ones. */
const TYPE_LABEL: Record<ColumnKind, string> = { text: 'Abc', integer: '123', decimal: '1.5', boolean: 'T/F', date: 'Date', timestamp: 'Time', json: '{ }' };

export const HEADER_HEIGHT = 52;

export interface HeaderInfo {
  kind: ColumnKind;
  quality?: Quality;
}

/** Token colours, read when the theme changes; canvas drawing can't use CSS variables. */
export function headerColors(el: Element = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue('--' + n).trim();
  return {
    bg: v('surface-sunken'), bgSelected: v('brand-tint'), ink: v('ink'), muted: v('ink-muted'), line: v('line'),
    tagBg: v('surface-raised'), valid: v('pass'), empty: v('line-strong'), error: v('fail'), brand: v('brand'),
    mono: v('font-mono'), ui: v('font-ui'),
  };
}

export type HeaderColors = ReturnType<typeof headerColors>;

/** Glide header: type tag, column name in mono, menu chevron, and the quality bar along the bottom (D19). */
export function makeDrawHeader(info: (col: number) => HeaderInfo | undefined, c: HeaderColors): DrawHeaderCallback {
  return ({ ctx, column, columnIndex, rect, isSelected }, drawContent) => {
    // The row-number column keeps Glide's own header.
    if (columnIndex < 0) return drawContent();
    const h = info(columnIndex);
    const { x, y, width, height } = rect;
    ctx.save();
    ctx.fillStyle = isSelected ? c.bgSelected : c.bg;
    ctx.fillRect(x, y, width, height);

    const pad = 8;
    const mid = y + 18;
    ctx.font = `600 10px ${c.ui}`;
    const tag = TYPE_LABEL[h?.kind ?? 'text'];
    const tagW = Math.ceil(ctx.measureText(tag).width) + 8;
    ctx.fillStyle = c.tagBg;
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    ctx.roundRect(x + pad, mid - 8, tagW, 16, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.muted;
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, x + pad + 4, mid);

    ctx.font = `600 12px ${c.mono}`;
    ctx.fillStyle = c.ink;
    const nameX = x + pad + tagW + 6;
    const maxW = width - (nameX - x) - 22;
    let name = column.title;
    if (ctx.measureText(name).width > maxW) {
      while (name.length > 1 && ctx.measureText(name + '…').width > maxW) name = name.slice(0, -1);
      name += '…';
    }
    ctx.fillText(name, nameX, mid);

    // Chevron for the column menu.
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + width - 16, mid - 2);
    ctx.lineTo(x + width - 12, mid + 2);
    ctx.lineTo(x + width - 8, mid - 2);
    ctx.stroke();

    // Quality bar: valid, empty, error.
    const q = h?.quality;
    const barY = y + height - 12;
    const barW = width - pad * 2;
    if (q) {
      const total = (q.valid ?? 1) + (q.empty ?? 0) + (q.error ?? 0) || 1;
      let bx = x + pad;
      for (const [share, color] of [[q.valid ?? 1, c.valid], [q.empty ?? 0, c.empty], [q.error ?? 0, c.error]] as const) {
        const w = (barW * share) / total;
        ctx.fillStyle = color;
        ctx.fillRect(bx, barY, w, 4);
        bx += w;
      }
    } else {
      ctx.fillStyle = c.line;
      ctx.fillRect(x + pad, barY, barW, 4);
    }
    if (isSelected) {
      ctx.fillStyle = c.brand;
      ctx.fillRect(x, y + height - 2, width, 2);
    }
    ctx.restore();
  };
}
