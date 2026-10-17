// How each locale writes numbers and dates, for the steps that read them: parse numbers and parse dates.
// Fixed tables, never the browser's Intl data, so a step gives the same result on every machine.
import { str } from './sql';

/** A word as the locale writes it (a regex alternation, matched whole and ignoring case) and the English word DuckDB's strptime reads. */
type Name = readonly [pattern: string, english: string];

export interface ParseLocale {
  label: string;
  /** The decimal mark; the other of . and , is read as a thousands separator. */
  decimal: '.' | ',';
  /** Whether 03/04/2026 is 3 April (true) or 4 March. */
  dayFirst: boolean;
  /** Month and weekday names that differ from English. Abbreviations may end with a full stop. */
  names: readonly Name[];
  /** Formats the locale writes dates in, tried by detection after the usual candidates. */
  formats: readonly string[];
}

/** Abbreviated names may be written with a full stop: févr., Okt. */
const abbr = (pattern: string, english: string): Name => [`(?:${pattern})\\.?`, english];

const GERMAN: readonly Name[] = [
  ['januar|jänner', 'January'],
  ['februar|feber', 'February'],
  ['märz|maerz', 'March'],
  ['mai', 'May'],
  ['juni', 'June'],
  ['juli', 'July'],
  ['oktober', 'October'],
  ['dezember', 'December'],
  abbr('jän', 'Jan'),
  abbr('mär|mrz', 'Mar'),
  abbr('okt', 'Oct'),
  abbr('dez', 'Dec'),
  ['montag', 'Monday'],
  ['dienstag', 'Tuesday'],
  ['mittwoch', 'Wednesday'],
  ['donnerstag', 'Thursday'],
  ['freitag', 'Friday'],
  ['samstag|sonnabend', 'Saturday'],
  ['sonntag', 'Sunday'],
];
const GERMAN_FORMATS = ['%d. %B %Y', '%d. %b %Y', '%A, %d. %B %Y'];

export const PARSE_LOCALES = {
  'en-GB': { label: 'English (UK)', decimal: '.', dayFirst: true, names: [], formats: ['%A %d %B %Y'] },
  'en-US': { label: 'English (US)', decimal: '.', dayFirst: false, names: [], formats: ['%A, %B %d, %Y'] },
  'de-DE': { label: 'German', decimal: ',', dayFirst: true, names: GERMAN, formats: GERMAN_FORMATS },
  'de-CH': { label: 'German (Switzerland)', decimal: '.', dayFirst: true, names: GERMAN, formats: GERMAN_FORMATS },
  'fr-FR': {
    label: 'French',
    decimal: ',',
    dayFirst: true,
    names: [
      ['janvier', 'January'],
      ['f[ée]vrier', 'February'],
      ['mars', 'March'],
      ['avril', 'April'],
      ['mai', 'May'],
      ['juin', 'June'],
      ['juillet', 'July'],
      ['ao[ûu]t', 'August'],
      ['septembre', 'September'],
      ['octobre', 'October'],
      ['novembre', 'November'],
      ['d[ée]cembre', 'December'],
      abbr('janv', 'Jan'),
      abbr('f[ée]vr', 'Feb'),
      abbr('avr', 'Apr'),
      abbr('juil', 'Jul'),
      abbr('sept', 'Sep'),
      abbr('d[ée]c', 'Dec'),
      ['lundi', 'Monday'],
      ['mardi', 'Tuesday'],
      ['mercredi', 'Wednesday'],
      ['jeudi', 'Thursday'],
      ['vendredi', 'Friday'],
      ['samedi', 'Saturday'],
      ['dimanche', 'Sunday'],
      // The first of the month: 1er janvier.
      ['1er', '1'],
    ],
    formats: ['%A %d %B %Y'],
  },
  'es-ES': {
    label: 'Spanish',
    decimal: ',',
    dayFirst: true,
    names: [
      ['enero', 'January'],
      ['febrero', 'February'],
      ['marzo', 'March'],
      ['abril', 'April'],
      ['mayo', 'May'],
      ['junio', 'June'],
      ['julio', 'July'],
      ['agosto', 'August'],
      ['septiembre|setiembre', 'September'],
      ['octubre', 'October'],
      ['noviembre', 'November'],
      ['diciembre', 'December'],
      abbr('ene', 'Jan'),
      abbr('abr', 'Apr'),
      abbr('ago', 'Aug'),
      abbr('sept|set', 'Sep'),
      abbr('dic', 'Dec'),
      ['lunes', 'Monday'],
      ['martes', 'Tuesday'],
      ['mi[ée]rcoles', 'Wednesday'],
      ['jueves', 'Thursday'],
      ['viernes', 'Friday'],
      ['s[áa]bado', 'Saturday'],
      ['domingo', 'Sunday'],
    ],
    formats: ['%d de %B de %Y', '%A, %d de %B de %Y'],
  },
  'nl-NL': {
    label: 'Dutch',
    decimal: ',',
    dayFirst: true,
    names: [
      ['januari', 'January'],
      ['februari', 'February'],
      ['maart', 'March'],
      ['mei', 'May'],
      ['juni', 'June'],
      ['juli', 'July'],
      ['augustus', 'August'],
      ['oktober', 'October'],
      abbr('mrt', 'Mar'),
      abbr('okt', 'Oct'),
      ['maandag', 'Monday'],
      ['dinsdag', 'Tuesday'],
      ['woensdag', 'Wednesday'],
      ['donderdag', 'Thursday'],
      ['vrijdag', 'Friday'],
      ['zaterdag', 'Saturday'],
      ['zondag', 'Sunday'],
    ],
    formats: ['%d %B %Y', '%A %d %B %Y'],
  },
} as const satisfies Record<string, ParseLocale>;

export type ParseLocaleId = keyof typeof PARSE_LOCALES;
export const PARSE_LOCALE_IDS = Object.keys(PARSE_LOCALES) as [ParseLocaleId, ...ParseLocaleId[]];

export const isParseLocale = (id: unknown): id is ParseLocaleId => typeof id === 'string' && Object.hasOwn(PARSE_LOCALES, id);

/** The locale's settings, or undefined for one the steps don't know. */
export const parseLocale = (id: string | undefined): ParseLocale | undefined => (isParseLocale(id) ? PARSE_LOCALES[id] : undefined);

/**
 * SQL turning the locale's month and weekday names in `expr` into English, so strptime's %B, %b and %A read them:
 * 31. Dezember 2026 becomes 31. December 2026. A name only matches as a whole word, in any case. English locales
 * leave the text as it is.
 */
export function englishDateNames(expr: string, locale: string | undefined): string {
  const names = parseLocale(locale)?.names ?? [];
  // Letters on either side would make it part of another word; \pL is any letter, accented ones included.
  return names.reduce((sql, [pattern, english]) => `regexp_replace(${sql}, ${str(`(^|[^\\pL])(?:${pattern})([^\\pL]|$)`)}, ${str(`\\1${english}\\2`)}, 'gi')`, expr);
}
