/** Abbreviated counts for nodes and badges: 1.2M, 8k, 1,204. The status strip always shows the full figure. */
export function abbreviate(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  return n.toLocaleString('en-GB');
}

/** Full-precision count with en-GB grouping: 1,204,113. */
export const fullCount = (n: number) => n.toLocaleString('en-GB');

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
