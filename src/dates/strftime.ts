// A strftime format applied in the browser, for the live example in the format to text form.
// Covers the specifiers people use; the step itself runs DuckDB's strftime.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The date the example is written for: Friday 1 March 2024, 14:05:09. */
export const EXAMPLE_DATE = new Date(Date.UTC(2024, 2, 1, 14, 5, 9));

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `date` (read as UTC) written with `format`, or undefined if the format uses a specifier this doesn't know. */
export function strftime(format: string, date: Date = EXAMPLE_DATE): string | undefined {
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth();
  const d = date.getUTCDate();
  const h = date.getUTCHours();
  const startOfYear = Date.UTC(y, 0, 1);
  const parts: Record<string, string> = {
    Y: String(y),
    y: pad(y % 100),
    m: pad(mo + 1),
    '-m': String(mo + 1),
    d: pad(d),
    '-d': String(d),
    e: String(d).padStart(2, ' '),
    B: MONTHS[mo]!,
    b: MONTHS[mo]!.slice(0, 3),
    A: DAYS[date.getUTCDay()]!,
    a: DAYS[date.getUTCDay()]!.slice(0, 3),
    w: String(date.getUTCDay()),
    H: pad(h),
    '-H': String(h),
    I: pad(h % 12 || 12),
    '-I': String(h % 12 || 12),
    p: h < 12 ? 'AM' : 'PM',
    M: pad(date.getUTCMinutes()),
    '-M': String(date.getUTCMinutes()),
    S: pad(date.getUTCSeconds()),
    '-S': String(date.getUTCSeconds()),
    j: pad(Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1, 3),
    '%': '%',
  };
  let unknown = false;
  const out = format.replace(/%(-?.)/g, (_, k: string) => {
    const v = parts[k];
    if (v == null) unknown = true;
    return v ?? `%${k}`;
  });
  return unknown || /%$/.test(format.replace(/%%/g, '')) ? undefined : out;
}
