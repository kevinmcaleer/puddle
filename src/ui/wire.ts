/** Bezier path for a wire between an output port and an input port. */
export function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

export type WireState = 'idle' | 'active' | 'broken';

export const wireClass = (state: WireState) => (state === 'idle' ? 'ui-wire' : `ui-wire ui-wire--${state}`);
