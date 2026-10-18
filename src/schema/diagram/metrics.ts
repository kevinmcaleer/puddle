// The diagram's sizes, from the design tokens, shared by the geometry and the layouts.
import tokens from '../../design-system/tokens.json';

const token = (group: 'size' | 'spacing', name: string): number => {
  const t = (tokens[group].tokens as { name: string; value: string }[]).find((x) => x.name === name);
  if (!t) throw new Error(`No ${group} token ${name}`);
  return parseFloat(t.value);
};

/** A row of a table: the header or one column. */
export const ROW = token('size', 'size-row');
export const PAD = token('spacing', 'space-3');
export const GAP = token('spacing', 'space-4');
/** Room for a key or ref glyph before a column name. */
export const GLYPH = token('spacing', 'space-4');
export const MIN_WIDTH = token('size', 'size-node-width') - token('spacing', 'space-8') * 2;
/** Between tables placed side by side. */
export const GUTTER = token('spacing', 'space-8') * 3;
export const MARGIN = token('spacing', 'space-8');
/** How far a ref line runs straight out of a table before it bends. */
export const STUB = token('spacing', 'space-6');
/** Below a table's last row. */
export const FOOT = token('spacing', 'space-1');
/** The data font is 12px JetBrains Mono, whose every glyph advances 0.6em. */
export const FONT = 12;
export const CHAR = FONT * 0.6;
/** A line of a sticky note's text. */
export const LINE = 18;
/** A sticky note's width. */
export const NOTE_WIDTH = token('size', 'size-node-width');
