// Date formats as people write them (DD/MM/YYYY), and back to the strptime codes the engine reads (%d/%m/%Y).
import { isNumberDateFormat, NUMBER_DATE_FORMATS } from './dateRead';

const WORDS: Record<string, string> = {
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

/** A format as people write it: %d/%m/%Y is DD/MM/YYYY, and excel serial is Excel serial number. Other codes stay as they are. */
export const formatWords = (format: string) => (isNumberDateFormat(format) ? NUMBER_DATE_FORMATS[format].label : format.replace(/%[YymdBbAaHIMSfpz]/g, (t) => WORDS[t] ?? t));

// Longest first, so YYYY isn't read as YY twice, Month as Mon, or +hh:mm as hh and mm.
const WORD = /%.|\+hh:mm|ffffff|Weekday|Month|YYYY|Wkd|Mon|YY|MM|DD|hh|mm|ss|AM|PM/g;
const CODES: Record<string, string> = { YYYY: '%Y', YY: '%y', MM: '%m', DD: '%d', Month: '%B', Mon: '%b', Weekday: '%A', Wkd: '%a', mm: '%M', ss: '%S', ffffff: '%f', AM: '%p', PM: '%p', '+hh:mm': '%z' };

/**
 * The strptime code for a format typed either way: DD/MM/YYYY and %d/%m/%Y both give %d/%m/%Y, and codes can be
 * mixed in (DD/MM/%Y). Hours are on the 12 hour clock when the format has AM or PM, else the 24 hour clock. The name
 * of a number format ("Excel serial number", any case) gives its key.
 */
export function formatFromWords(typed: string): string {
  const text = typed.trim();
  for (const [key, f] of Object.entries(NUMBER_DATE_FORMATS)) if (text.toLowerCase() === f.label.toLowerCase() || text.toLowerCase() === key) return key;
  const twelve = /AM|PM|%p/.test(text);
  return text.replace(WORD, (t) => (t.startsWith('%') ? t : t === 'hh' ? (twelve ? '%I' : '%H') : (CODES[t] ?? t)));
}

/** A list of formats as typed, separated by commas ("DD/MM/YYYY, YYYY-MM-DD"), as codes. A comma inside a format ("Month DD, YYYY") can't be typed this way. */
export const formatsFromWords = (typed: string) => typed.split(',').map((f) => formatFromWords(f)).filter(Boolean);
