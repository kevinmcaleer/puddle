// Date format detection: which formats read a column, and the few that together read as much of it as they can.
// Day and month order is never guessed: values that can only be read one way settle it, else the project's own
// formats or the step's locale do, else it is asked.
import { isNumberDateFormat, NUMBER_DATE_FORMATS } from '../compiler/dateRead';
import { parseLocale } from '../compiler/locales';

/** The numeric day and month formats, both ways round, with each separator and year, and with times of day. */
function dayMonthFormats(): string[] {
  const out: string[] = [];
  for (const sep of ['/', '-', '.']) {
    for (const [a, b] of [
      ['%d', '%m'],
      ['%m', '%d'],
    ]) {
      const date = `${a}${sep}${b}${sep}%Y`;
      out.push(date, `${a}${sep}${b}${sep}%y`, `${date} %H:%M`, `${date} %H:%M:%S`, `${date} %I:%M %p`, `${date} %I:%M:%S %p`);
    }
  }
  return out;
}

/** Formats tried on every column, most common first. Ties in match rate keep this order. */
export const CANDIDATE_FORMATS = [
  // ISO 8601 and its relatives, year first.
  '%Y-%m-%d',
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%d %H:%M',
  '%Y-%m-%d %H:%M:%S.%f',
  '%Y-%m-%dT%H:%M:%S',
  '%Y-%m-%dT%H:%M',
  '%Y-%m-%dT%H:%M:%S.%f',
  '%Y-%m-%dT%H:%M:%SZ',
  '%Y-%m-%dT%H:%M:%S.%fZ',
  '%Y-%m-%dT%H:%M:%S%z',
  '%Y-%m-%dT%H:%M:%S.%f%z',
  '%Y-%m-%d %H:%M:%S%z',
  '%Y/%m/%d',
  '%Y/%m/%d %H:%M:%S',
  '%Y/%m/%d %H:%M',
  '%Y.%m.%d',
  '%Y%m%d',
  ...dayMonthFormats(),
  // Month names, full (%B) and abbreviated (%b), with and without the weekday.
  '%d %B %Y',
  '%d %b %Y',
  '%B %d, %Y',
  '%b %d, %Y',
  '%B %d %Y',
  '%b %d %Y',
  '%d %B, %Y',
  '%d-%b-%Y',
  '%d-%B-%Y',
  '%d-%b-%y',
  '%d %b %y',
  '%d/%b/%Y',
  '%Y-%b-%d',
  '%b-%d-%Y',
  '%A %d %B %Y',
  '%A, %d %B %Y',
  '%a %d %b %Y',
  '%a, %d %b %Y',
  '%A, %B %d, %Y',
  '%a, %b %d, %Y',
  '%a %b %d %Y',
  '%d %B %Y %H:%M',
  '%d %b %Y %H:%M',
  '%d %b %Y %H:%M:%S',
  '%B %d, %Y %H:%M',
  '%B %d, %Y %I:%M %p',
  '%b %d, %Y %I:%M %p',
  // Email (RFC 2822), C's ctime, and web server logs.
  '%a, %d %b %Y %H:%M:%S %z',
  '%a %b %d %H:%M:%S %Y',
  '%d/%b/%Y:%H:%M:%S %z',
  // Numbers that stand for dates.
  ...Object.keys(NUMBER_DATE_FORMATS),
];

export interface FormatMatch {
  format: string;
  matched: number;
  total: number;
  /** A value the format reads, to show what it looks like. */
  example?: string | null;
}

/** A distinct value from a column's sample: how often it appears, and the formats tried that read it. */
export interface ValueReads {
  value: string;
  count: number;
  reads: string[];
}

export type Order = 'day' | 'month';

export interface Detection {
  /** Formats that read at least one value, best first. */
  ranked: FormatMatch[];
  /**
   * The formats to use without asking, in the order to try them: the fewest that together read every value any of
   * them can. Undefined when nothing matched or the day and month order is unclear.
   */
  formats?: string[];
  /** Every distinct value in the sample and the formats that read it, to tell which values a list of formats misses. */
  values?: ValueReads[];
  /** The formats detection tried. A format outside them hasn't been checked against the values. */
  tried?: string[];
  /**
   * Set when values could be read day first or month first. `dayFirst` and `monthFirst` are the commonest such
   * format each way; `covers` the formats to use for each order. It is settled (and `formats` set) by values that
   * fit only one order (`byValues` is one), or else by the locale (`byLocale`); otherwise the user must choose.
   */
  ambiguous?: {
    dayFirst: string;
    monthFirst: string;
    example?: string | null;
    covers: Record<Order, string[]>;
    /** The order that values fitting only one way, or the locale, settled on. */
    order?: Order;
    byValues?: string;
    byLocale?: string;
    /** Values that fit only day first and others only month first: the column mixes both, and one order loses. */
    mixed?: Record<Order, string>;
  };
}

/** The same format with day and month swapped, or undefined if it doesn't have both. */
export function swapDayMonth(format: string): string | undefined {
  if (!format.includes('%d') || !format.includes('%m')) return undefined;
  return format.replace(/%d|%m/g, (t) => (t === '%d' ? '%m' : '%d'));
}

/** Whether the format puts the day before the month. */
export const dayFirst = (format: string) => format.indexOf('%d') < format.indexOf('%m');

/**
 * Which way round a numeric day and month format reads, or undefined for one where that can't be mixed up: no
 * numeric day and month, or the year first (%Y-%m-%d).
 */
export function orderOf(format: string): Order | undefined {
  const d = format.indexOf('%d');
  const m = format.indexOf('%m');
  if (d < 0 || m < 0) return undefined;
  const y = format.search(/%[Yy]/);
  if (y >= 0 && y < Math.min(d, m)) return undefined;
  return d < m ? 'day' : 'month';
}

/** The formats to try: the project's own first, then the candidates, then the locale's own, without repeats. */
export const formatsToTry = (projectFormats: string[], locale?: string) => [...new Set([...projectFormats, ...CANDIDATE_FORMATS, ...(parseLocale(locale)?.formats ?? [])])];

/**
 * Pick formats greedily: each time the one reading the most values the ones before it don't, ties going to the
 * earlier in `order`, until none adds any.
 */
function cover(values: ValueReads[], allowed: string[], order: string[]): string[] {
  const pos = (f: string) => order.indexOf(f);
  const left = new Set(values.filter((v) => v.reads.some((f) => allowed.includes(f))));
  const picked: string[] = [];
  for (;;) {
    let best: string | undefined;
    let gain = 0;
    for (const f of allowed) {
      if (picked.includes(f)) continue;
      let g = 0;
      for (const v of left) if (v.reads.includes(f)) g += v.count;
      if (g > gain || (g === gain && g > 0 && best != null && pos(f) < pos(best))) [best, gain] = [f, g];
    }
    if (!best) return picked;
    picked.push(best);
    for (const v of [...left]) if (v.reads.includes(best)) left.delete(v);
  }
}

/**
 * Rank the formats by share of values read (ties go to the project's formats, then the candidate order) and choose
 * the formats to use. Day and month order: values that fit only one way settle it; else a project format with an
 * order does, then the locale; else it is left to the user, with the formats for either order ready.
 */
export function rankFormats(values: ValueReads[], projectFormats: string[] = [], locale?: string): Detection {
  const order = formatsToTry(projectFormats, locale);
  const pos = (f: string) => {
    const i = order.indexOf(f);
    return i < 0 ? order.length : i;
  };
  const total = values.reduce((n, v) => n + v.count, 0);
  const stats = new Map<string, FormatMatch>();
  for (const v of values) {
    for (const f of v.reads) {
      const s = stats.get(f) ?? { format: f, matched: 0, total, example: v.value };
      s.matched += v.count;
      stats.set(f, s);
    }
  }
  const ranked = [...stats.values()].sort((a, b) => b.matched - a.matched || pos(a.format) - pos(b.format));
  if (!ranked.length) return { ranked, values };
  const used = ranked.map((m) => m.format);
  const coverFor = (o?: Order) => cover(values, used.filter((f) => !orderOf(f) || orderOf(f) === o), order);

  // Values that fit only one order are evidence of it; values that fit both are what makes it a question.
  const fits = (v: ValueReads, o: Order) => v.reads.some((f) => orderOf(f) === o);
  const only = (o: Order) => values.find((v) => fits(v, o) && !fits(v, o === 'day' ? 'month' : 'day'));
  const either = values.find((v) => fits(v, 'day') && fits(v, 'month'));
  const onlyDay = only('day');
  const onlyMonth = only('month');
  if (!either && !(onlyDay && onlyMonth)) return { ranked, values, formats: coverFor(onlyDay ? 'day' : onlyMonth ? 'month' : undefined) };

  const top = (o: Order) => ranked.find((m) => orderOf(m.format) === o)?.format;
  const d = top('day') ?? swapDayMonth(top('month')!)!;
  const m = top('month') ?? swapDayMonth(d)!;
  const covers = { day: coverFor('day'), month: coverFor('month') };
  const base = { dayFirst: d, monthFirst: m, example: either?.value ?? null, covers };
  const settledBy = (o: Order, extra: Partial<NonNullable<Detection['ambiguous']>>) => ({ ranked, values, formats: covers[o], ambiguous: { ...base, order: o, ...extra } });

  if (onlyDay && !onlyMonth) return settledBy('day', { byValues: onlyDay.value });
  if (onlyMonth && !onlyDay) return settledBy('month', { byValues: onlyMonth.value });
  // A project format settles the order: that's what the setting is for.
  const projectOrder = projectFormats.map(orderOf).find((o) => o);
  if (projectOrder) return { ranked, values, formats: covers[projectOrder] };
  const mixed = onlyDay && onlyMonth ? { mixed: { day: onlyDay.value, month: onlyMonth.value } } : {};
  const settled = parseLocale(locale);
  if (settled) return settledBy(settled.dayFirst ? 'day' : 'month', { byLocale: locale, ...mixed });
  return { ranked, values, ambiguous: { ...base, ...mixed } };
}

/**
 * The values none of `formats` reads, with how many there are of the sample's `total`; undefined when a format
 * wasn't tried, so isn't known to read or miss anything.
 */
export function unreadValues(detection: Detection, formats: string[]): { examples: string[]; count: number; total: number } | undefined {
  const { values, tried } = detection;
  if (!values || !tried || formats.some((f) => !tried.includes(f))) return undefined;
  const missed = values.filter((v) => !v.reads.some((f) => formats.includes(f)));
  return { examples: missed.slice(0, 3).map((v) => v.value), count: missed.reduce((n, v) => n + v.count, 0), total: values.reduce((n, v) => n + v.count, 0) };
}

const PARTS: Record<string, string> = {
  '%Y': 'YYYY',
  '%y': 'YY',
  '%m': 'MM',
  '%d': 'DD',
  '%B': 'Month',
  '%b': 'Mon',
  '%A': 'Weekday',
  '%a': 'Wkd',
  '%H': 'hh',
  '%I': 'hh',
  '%M': 'mm',
  '%S': 'ss',
  '%f': 'ffffff',
  '%p': 'AM',
  '%z': '+hh:mm',
};

/** A format as people write it, e.g. %d/%m/%Y → DD/MM/YYYY, and excel serial → Excel serial number. */
export const describeFormat = (format: string) => (isNumberDateFormat(format) ? NUMBER_DATE_FORMATS[format].label : format.replace(/%[YymdBbAaHIMSfpz]/g, (t) => PARTS[t] ?? t));
