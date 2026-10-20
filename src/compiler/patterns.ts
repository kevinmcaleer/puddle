// Patterns the analysis queries share: what a placeholder for "empty" looks like, what reads as a number or a date
// once symbols and day-first orders are allowed for, and what mangled text (mojibake) looks like. RE2 syntax: no
// backreferences or lookarounds.
import { str } from './sql';

/** Words and marks people put in a cell to mean "nothing here", lower case and trimmed. */
export const PLACEHOLDERS = [
  'n/a', 'na', 'n.a.', 'n.a', '#n/a', 'n/a.', 'not available', 'not applicable',
  '-', '--', '---', '?', '??', '.', '...',
  'null', 'nil', 'none', 'nan', 'unknown', 'missing', 'tbd', 'tbc',
  '(blank)', '(empty)', '(null)', '(none)', '#null!', '#value!', '#ref!', '#div/0!', '#name?',
];

/**
 * A number as people write it: an optional currency symbol before or a symbol or code after, thousands separated by
 * a comma, point or space, a comma or point before the decimals, brackets or a trailing minus for a negative, a
 * percent sign. Dates (2025-02-07, 12.03.2026) and phone numbers (07700 900381) don't fit.
 */
export const NUMBER_PATTERN = '^\\(?\\s*-?\\s*[£$€¥]?\\s*-?(\\d{1,3}([,. ]\\d{3})*|\\d+)([.,]\\d+)?\\s*%?\\s*([£$€¥]|[A-Z]{3})?\\s*\\)?-?$';

/**
 * A date as people write it: numeric with slashes, points or dashes in either order, a month name before or after
 * the day (with an ordinal), a compact 20260312, each with an optional time and zone.
 */
export const DATE_PATTERN =
  '^(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}[/.-]\\d{1,2}[/.-]\\d{1,2}|\\d{1,2}(st|nd|rd|th)?\\.?\\s+(of\\s+)?[a-z]{3,9}\\.?,?\\s+\\d{4}|[a-z]{3,9}\\.?\\s+\\d{1,2}(st|nd|rd|th)?,?\\s+\\d{4}|\\d{4}[01]\\d[0-3]\\d)' +
  '([ t]\\d{1,2}:\\d{2}(:\\d{2}(\\.\\d+)?)?\\s*([ap]m)?\\s*(z|[+-]\\d{2}:?\\d{2}|utc|gmt)?)?$';

/**
 * UTF-8 text read as Latin-1 or Windows-1252 and kept that way: é as Ã©, ’ as â€™, £ as Â£. "Ã" followed by a
 * character from the top half of Latin-1 or Windows-1252's punctuation block, "â€", or "Â" before a symbol.
 */
export const MOJIBAKE_PATTERN = '(Ã[\\x{0080}-\\x{00BF}‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|â€|Â[\\x{00A0}-\\x{00BF}])';

/**
 * Mangled sequences and the characters they stand for, longest first so "â€™" is put right before "Â" or "â" alone
 * could be. The common accented letters of western European languages, the smart punctuation and the symbols.
 */
export const MOJIBAKE_FIXES: [string, string][] = [
  ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€\u009d', '”'], ['â€', '”'], ['â€“', '–'], ['â€”', '—'], ['â€¦', '…'], ['â€¢', '•'], ['â‚¬', '€'], ['â„¢', '™'],
  ['Ã©', 'é'], ['Ã¨', 'è'], ['Ãª', 'ê'], ['Ã«', 'ë'], ['Ã¡', 'á'], ['Ã ', 'à'], ['Ã¢', 'â'], ['Ã£', 'ã'], ['Ã¤', 'ä'], ['Ã¥', 'å'], ['Ã¦', 'æ'],
  ['Ã­', 'í'], ['Ã¬', 'ì'], ['Ã®', 'î'], ['Ã¯', 'ï'], ['Ã³', 'ó'], ['Ã²', 'ò'], ['Ã´', 'ô'], ['Ãµ', 'õ'], ['Ã¶', 'ö'], ['Ã¸', 'ø'],
  ['Ãº', 'ú'], ['Ã¹', 'ù'], ['Ã»', 'û'], ['Ã¼', 'ü'], ['Ã±', 'ñ'], ['Ã§', 'ç'], ['ÃŸ', 'ß'], ['Ã½', 'ý'], ['Ã¿', 'ÿ'],
  ['Ã‰', 'É'], ['Ãˆ', 'È'], ['ÃŠ', 'Ê'], ['Ã‹', 'Ë'], ['Ã\u0081', 'Á'], ['Ã€', 'À'], ['Ã‚', 'Â'], ['Ãƒ', 'Ã'], ['Ã„', 'Ä'], ['Ã…', 'Å'], ['Ã†', 'Æ'],
  ['Ã\u008d', 'Í'], ['ÃŒ', 'Ì'], ['ÃŽ', 'Î'], ['Ã\u008f', 'Ï'], ['Ã“', 'Ó'], ['Ã’', 'Ò'], ['Ã”', 'Ô'], ['Ã•', 'Õ'], ['Ã–', 'Ö'], ['Ã˜', 'Ø'],
  ['Ãš', 'Ú'], ['Ã™', 'Ù'], ['Ã›', 'Û'], ['Ãœ', 'Ü'], ['Ã‘', 'Ñ'], ['Ã‡', 'Ç'], ['Ã\u009d', 'Ý'],
  ['Â£', '£'], ['Â©', '©'], ['Â®', '®'], ['Â°', '°'], ['Â±', '±'], ['Â²', '²'], ['Â³', '³'], ['Âµ', 'µ'], ['Â·', '·'], ['Â½', '½'], ['Â¼', '¼'], ['Â¾', '¾'], ['Â¿', '¿'], ['Â¡', '¡'], ['Â§', '§'], ['Â«', '«'], ['Â»', '»'], ['Â ', ' '],
];

/** SQL that is true when a trimmed text value is one of the placeholders for empty. */
export const isPlaceholder = (trimmed: string) => `lower(${trimmed}) IN (${PLACEHOLDERS.map(str).join(', ')})`;

/** SQL that is true when a trimmed text value reads as a number, allowing for symbols, separators and brackets. */
export const looksLikeNumber = (trimmed: string) => `(TRY_CAST(${trimmed} AS DOUBLE) IS NOT NULL OR regexp_matches(${trimmed}, ${str(NUMBER_PATTERN)}))`;

/** SQL that is true when a trimmed text value reads as a date in one of the ways people write them. */
export const looksLikeDate = (trimmed: string) => `(TRY_CAST(${trimmed} AS DATE) IS NOT NULL OR regexp_matches(${trimmed}, ${str(DATE_PATTERN)}, 'i'))`;

