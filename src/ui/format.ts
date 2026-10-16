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

/** Memory and file sizes in binary units, as DuckDB reports them: 512 B, 4.2 KB, 5.1 MB, 1.3 GB. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Math.max(0, bytes);
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return u === 0 ? `${Math.round(n)} B` : `${n.toFixed(1).replace(/\.0$/, '')} ${units[u]}`;
}
