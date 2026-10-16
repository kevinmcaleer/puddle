// Excel's limits and naming rules, without SheetJS, so the main thread can check them before an export runs.
import { MAX_COL, MAX_ROW } from './range';

/** Rows an Excel sheet holds, the header included. */
export const SHEET_ROWS = MAX_ROW + 1;
export const SHEET_COLUMNS = MAX_COL + 1;

/** Excel's rules for sheet names: 1 to 31 characters, none of \ / ? * [ ] :, and no quote at either end. */
export function sheetNameProblem(name: string): string | undefined {
  if (!name.trim()) return 'Give the sheet a name.';
  if (name.length > 31) return 'Sheet names can be at most 31 characters long.';
  if (/[\\/?*[\]:]/.test(name)) return 'Sheet names can’t contain \\ / ? * [ ] or :.';
  if (/^'|'$/.test(name)) return 'Sheet names can’t start or end with an apostrophe.';
  return undefined;
}

/** A valid sheet name from any text, such as an Output node's name. */
export function toSheetName(text: string): string {
  const cleaned = text.replace(/[\\/?*[\]:]+/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 31).trim();
  return cleaned || 'Sheet1';
}

/** Why rows past Excel's limit aren't exported. Shared with the main thread's check before the export runs. */
export function tooManyRows(rows: number, header: boolean): string {
  const room = SHEET_ROWS - (header ? 1 : 0);
  return `This output has ${rows.toLocaleString('en-GB')} rows; an Excel sheet holds at most ${room.toLocaleString('en-GB')}${header ? ' below its header' : ''}. Export it as CSV or Parquet instead, which have no row limit.`;
}
