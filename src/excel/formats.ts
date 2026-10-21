// The spreadsheet formats SheetJS reads for Puddle, by file extension, and how each is named on a node. Nothing here
// imports SheetJS, so the main thread, the sniff and the runner share it. Every one is stored as the source format
// 'xlsx': the same worker reads them all, and the read options (sheet, header row, range) mean the same in each.

/** What a spreadsheet file's extension says it is, as the node card and the inspector name it. */
export const SPREADSHEET_LABELS: Record<string, string> = {
  xlsx: 'Excel',
  xlsm: 'Excel',
  xls: 'Excel 97-2003',
  xlsb: 'Excel binary',
  ods: 'OpenDocument',
  fods: 'OpenDocument',
  numbers: 'Numbers',
  dbf: 'dBase',
  dif: 'DIF',
  slk: 'SYLK',
  sylk: 'SYLK',
  wk1: 'Lotus 1-2-3',
};

/** The extensions read as spreadsheets, .xlsx first. */
export const SPREADSHEET_EXTENSIONS = Object.keys(SPREADSHEET_LABELS);

/** How a spreadsheet source is named from its file name: "Excel 97-2003" for a .xls, "Excel" when the name says nothing. */
export function spreadsheetLabel(name: string): string {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return SPREADSHEET_LABELS[ext] ?? 'Excel';
}
