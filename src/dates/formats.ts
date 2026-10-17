// Date format detection: which strptime formats read a column, ranked, with day and month order never guessed:
// it is asked, or follows the locale the parse dates step was given.
import { parseLocale } from '../compiler/locales';

/** Formats tried on every column, most common first. Ties in match rate keep this order. */
export const CANDIDATE_FORMATS = [
  '%Y-%m-%d',
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%dT%H:%M:%S',
  '%Y/%m/%d',
  '%d/%m/%Y',
  '%m/%d/%Y',
  '%d-%m-%Y',
  '%m-%d-%Y',
  '%d.%m.%Y',
  '%d/%m/%y',
  '%m/%d/%y',
  '%d/%m/%Y %H:%M',
  '%m/%d/%Y %H:%M',
  '%d %B %Y',
  '%d %b %Y',
  '%B %d, %Y',
  '%b %d, %Y',
  '%d-%b-%Y',
  '%Y%m%d',
];

export interface FormatMatch {
  format: string;
  matched: number;
  total: number;
  /** A value the format reads, to show what it looks like. */
  example?: string | null;
}

export interface Detection {
  /** Formats that read at least one value, best first. */
  ranked: FormatMatch[];
  /** The format to use without asking, or undefined when nothing matched or the order is ambiguous. */
  best?: string;
  /**
   * Set when the top format reads exactly the same values with day and month swapped: the user must choose, unless
   * a locale was given, which settles it (`byLocale`) and makes its order `best`.
   */
  ambiguous?: { dayFirst: string; monthFirst: string; example?: string | null; byLocale?: string };
}

/** The same format with day and month swapped, or undefined if it doesn't have both. */
export function swapDayMonth(format: string): string | undefined {
  if (!format.includes('%d') || !format.includes('%m')) return undefined;
  return format.replace(/%d|%m/g, (t) => (t === '%d' ? '%m' : '%d'));
}

/** Whether the format puts the day before the month. */
export const dayFirst = (format: string) => format.indexOf('%d') < format.indexOf('%m');

/** The formats to try: the project's own first, then the candidates, then the locale's own, without repeats. */
export const formatsToTry = (projectFormats: string[], locale?: string) => [...new Set([...projectFormats, ...CANDIDATE_FORMATS, ...(parseLocale(locale)?.formats ?? [])])];

/**
 * Rank matches by share of values read; ties go to the project's formats, then the candidate order. With a locale,
 * a day and month order the values leave open is the locale's.
 */
export function rankFormats(matches: FormatMatch[], projectFormats: string[] = [], locale?: string): Detection {
  const order = formatsToTry(projectFormats, locale);
  const pos = (f: string) => {
    const i = order.indexOf(f);
    return i < 0 ? order.length : i;
  };
  const ranked = matches.filter((m) => m.matched > 0).sort((a, b) => b.matched / b.total - a.matched / a.total || pos(a.format) - pos(b.format));
  const top = ranked[0];
  if (!top) return { ranked };
  const swapped = swapDayMonth(top.format);
  const twin = swapped && ranked.find((m) => m.format === swapped && m.matched === top.matched);
  // A project format settles the order: that's what the setting is for.
  if (twin && !projectFormats.includes(top.format)) {
    const [d, m] = dayFirst(top.format) ? [top, twin] : [twin, top];
    const settled = parseLocale(locale);
    if (settled) return { ranked, best: settled.dayFirst ? d.format : m.format, ambiguous: { dayFirst: d.format, monthFirst: m.format, example: top.example, byLocale: locale } };
    return { ranked, ambiguous: { dayFirst: d.format, monthFirst: m.format, example: top.example } };
  }
  return { ranked, best: top.format };
}

const PARTS: Record<string, string> = {
  '%Y': 'YYYY',
  '%y': 'YY',
  '%m': 'MM',
  '%d': 'DD',
  '%B': 'Month',
  '%b': 'Mon',
  '%H': 'hh',
  '%M': 'mm',
  '%S': 'ss',
};

/** A format as people write it, e.g. %d/%m/%Y → DD/MM/YYYY. */
export const describeFormat = (format: string) => format.replace(/%[YymdBbHMS]/g, (t) => PARTS[t] ?? t);
