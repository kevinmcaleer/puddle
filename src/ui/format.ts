// Every number and date the app shows goes through here, in the display locale (locale.ts). Values keep what they
// are: only how they're written changes, and the data, steps and exports never see it.
import type { ColumnKind } from './columnKind';
import { displayFormat, type DisplayFormat } from './locale';

const numberFormats = new Map<string, Intl.NumberFormat>();
const numberFormat = (locale: string, digits = 0) => {
  const key = `${locale}|${digits}`;
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })));
  return f;
};

/** The locale's decimal mark and minus sign. */
function symbols(locale: string): { decimal: string; minus: string } {
  const parts = numberFormat(locale, 1).formatToParts(-1.5);
  return { decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.', minus: parts.find((p) => p.type === 'minusSign')?.value ?? '-' };
}

/** Abbreviated counts for nodes and badges: 1.2M, 8k, 1,204 (in en-GB). The status strip always shows the full figure. */
export function abbreviate(n: number | null | undefined, f: DisplayFormat = displayFormat()): string | null {
  if (n == null) return null;
  if (n >= 1e6) return numberFormat(f.locale, 1).format(Math.round(n / 1e5) / 10) + 'M';
  if (n >= 1e4) return numberFormat(f.locale).format(Math.round(n / 1e3)) + 'k';
  return numberFormat(f.locale).format(n);
}

/** Full-precision count with the locale's grouping: 1,204,113 in en-GB, 1.204.113 in de-DE. */
export const fullCount = (n: number, f: DisplayFormat = displayFormat()) => numberFormat(f.locale).format(n);

/**
 * A number as DuckDB writes it as text (1234567.891, -12, 1.5e-07) in the locale's grouping, decimal mark and minus
 * sign. Worked on the digits, so a BIGINT or DECIMAL past a double's precision keeps every digit. Anything else
 * (inf, nan) is left as it is.
 */
export function formatNumberText(text: string, locale: string): string {
  const { decimal, minus } = symbols(locale);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (m) {
    const whole = BigInt(m[2]!).toLocaleString(locale);
    return `${m[1] ? minus : ''}${whole}${m[3] ? decimal + m[3] : ''}`;
  }
  const e = /^(-?)(\d+)(?:\.(\d+))?(e[+-]?\d+)$/i.exec(text);
  if (e) return `${e[1] ? minus : ''}${e[2]}${e[3] ? decimal + e[3] : ''}${e[4]}`;
  return text;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(locale: string, time: boolean) {
  const key = `${locale}|${time}`;
  let f = dateFormats.get(key);
  if (!f) {
    // Four-digit years and two-digit days and months, so a date never reads as anything else; UTC so no time zone moves it.
    const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', ...(time && { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
    dateFormats.set(key, (f = new Intl.DateTimeFormat(locale, opts)));
  }
  return f;
}

/**
 * A date or timestamp as DuckDB writes it as text (2026-12-31, 2026-12-31 14:05:09.123456, with an offset for
 * TIMESTAMPTZ) in the locale's short form: 31/12/2026 14:05:09.123456 in en-GB, 12/31/2026, 02:05:09.123456 PM in
 * en-US. Fractions of a second and the offset are kept as written. ISO, years before 1000 and anything
 * unexpected (infinity) are left as DuckDB wrote them.
 */
export function formatDateText(text: string, f: DisplayFormat): string {
  if (f.dates === 'iso') return text;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?)?([+-]\d{2}(?::?\d{2})?)?$/.exec(text);
  // Intl writes years before 1000 with fewer digits, so those stay ISO.
  if (!m || Number(m[1]) < 1000) return text;
  const [y, mo, d, h, mi, sec] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0)) as [number, number, number, number, number, number];
  const at = new Date(0);
  at.setUTCFullYear(y, mo - 1, d);
  at.setUTCHours(h, mi, sec, 0);
  if (Number.isNaN(at.getTime())) return text;
  const time = m[4] != null;
  const parts = dateFormat(f.locale, time).formatToParts(at);
  const fraction = m[7] ? symbols(f.locale).decimal + m[7].slice(1) : '';
  return parts.map((p) => (p.type === 'second' ? p.value + fraction : p.value)).join('') + (m[8] ? ` ${m[8]}` : '');
}

const instantFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A moment (an ISO time such as a save or sync time) in this computer's time zone, written the display locale's way
 * with a short month name: 16 Oct 2026, 09:30 in en-GB, 16. Okt. 2026, 09:30 in de-DE. With `seconds`, to the second.
 */
export function formatInstant(iso: string, seconds = false, f: DisplayFormat = displayFormat()): string {
  const key = `${f.locale}|${seconds}`;
  let fmt = instantFormats.get(key);
  if (!fmt) instantFormats.set(key, (fmt = new Intl.DateTimeFormat(f.locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(seconds && { second: '2-digit' }) })));
  return fmt.format(new Date(iso));
}

/** A value from the results table (DuckDB's text for it) as it's shown, by the column's kind. */
export function formatValue(text: string, kind: ColumnKind, f: DisplayFormat = displayFormat()): string {
  if (kind === 'integer' || kind === 'decimal') return formatNumberText(text, f.locale);
  if (kind === 'date' || kind === 'timestamp') return formatDateText(text, f);
  return text;
}

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
