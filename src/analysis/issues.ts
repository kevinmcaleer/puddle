// The issue catalogue: every kind of problem analysis can find in a node's data, in the user's words, with how
// serious it is and the step that clears it. Detectors (columns.ts) make issues; the Issues panel shows them;
// Fix all turns their fixes into steps.
import type { ParseOptions } from '../model';

export type IssueKind =
  | 'bannerRows'
  | 'footerRows'
  | 'repeatedHeader'
  | 'narrowRows'
  | 'blankRows'
  | 'totalRows'
  | 'skewedRows'
  | 'mergedCells'
  | 'duplicateRows'
  | 'edgeSpaces'
  | 'doubleSpaces'
  | 'nonPrinting'
  | 'emptyText'
  | 'numbersAsText'
  | 'datesAsText'
  | 'mixedCase'
  | 'placeholders'
  | 'booleansAsText'
  | 'serialDates'
  | 'mixedTypes'
  | 'nearDuplicate'
  | 'inconsistentShapes'
  | 'idDuplicates'
  | 'untidyNames'
  | 'emptyColumn'
  | 'constantColumn'
  | 'indexColumn'
  | 'wideTable'
  | 'keyValue'
  | 'mojibake';

/**
 * `fix`: Fix all applies it without being asked. `suggest`: listed unticked, because applying it could change what
 * a value means (D22). `info`: worth knowing, nothing to apply.
 */
export type IssueSeverity = 'fix' | 'suggest' | 'info';

/**
 * A fix is a step added after the node, several steps (one Replace values per placeholder), or a change to the
 * source's read options (a banner skipped at the top, placeholders read as empty).
 */
export type IssueFix = StepFix | StepsFix | ReadOptionsFix;

export interface StepFix {
  /** The step type that clears the issue. */
  type: string;
  /** Settings the step needs beyond its columns, e.g. the case to change to. */
  params?: Record<string, unknown>;
}

export interface ReadOptionsFix {
  readOptions: ParseOptions;
  /** What it does, in words: "Skip 5 lines at the top". */
  label: string;
}

export interface StepsFix {
  /** The steps, in the order they run. */
  steps: StepFix[];
  /** What they do, in words: "Replace values". */
  label: string;
}

export const isStepFix = (fix: IssueFix | undefined): fix is StepFix => fix != null && 'type' in fix;
export const isStepsFix = (fix: IssueFix | undefined): fix is StepsFix => fix != null && 'steps' in fix;
export const isReadOptionsFix = (fix: IssueFix | undefined): fix is ReadOptionsFix => fix != null && 'readOptions' in fix;

/** The steps a fix adds: one, several, or none for a read option change. */
export const fixSteps = (fix: IssueFix | undefined): StepFix[] => (isStepFix(fix) ? [fix] : isStepsFix(fix) ? fix.steps : []);

export interface Issue {
  /** Names the issue for ignoring: the kind and the column. */
  key: string;
  kind: IssueKind;
  /** The column, or undefined for an issue about the whole table. */
  column?: string;
  /** The value the issue is about, for issues listed per value (a likely misspelling). */
  value?: string;
  /** Rows (or, for mixed capitals, values) the issue touches. */
  count: number;
  /** The share of non-empty values touched, 0 to 1, when it is known. */
  share?: number;
  /** Two or three values from the data that show it. */
  examples: string[];
  severity: IssueSeverity;
  fix?: IssueFix;
}

export interface IssueKindDef {
  /** What was found, with the column: "Spaces at either end of name"; per-value issues get the value and the examples too. */
  label: (column: string | undefined, detail: Pick<Issue, 'value' | 'examples' | 'fix'>) => string;
  /** The detail line, e.g. what Fix all will do. */
  about: string;
}

export const ISSUE_KINDS: Record<IssueKind, IssueKindDef> = {
  bannerRows: { label: () => 'Lines above the table', about: 'A title, a date or page headings before the header row.' },
  footerRows: { label: () => 'Lines after the table', about: 'A row count, a signature or "End of report" after the last row.' },
  repeatedHeader: { label: () => 'Header row repeated', about: 'The header appears again inside the data, as when two exports were pasted together.' },
  narrowRows: { label: () => 'Separator and page-break rows', about: 'Rows with only the first column filled: lines of dashes, page breaks, headings on a later page.' },
  blankRows: { label: () => 'Blank rows', about: 'Rows with nothing in any column.' },
  totalRows: { label: () => 'Total rows inside the data', about: 'Rows that sum the rows above them; keeping them would count every value twice.' },
  mergedCells: { label: () => 'Merged cells left empty', about: 'Cells merged in the sheet have their value in the first cell only, so the rows below it read as empty. Filled, every row carries it.' },
  skewedRows: { label: (c, d) => `Rows shifted one column ${d.value ?? 'over'} from ${c}`, about: 'A cell was deleted or inserted, so from that column on the values sit under the wrong headers. Realign rows moves them back and gives the columns their types.' },
  edgeSpaces: { label: (c) => `Spaces at either end of ${c}`, about: 'Values start or end with a space, so equal values don’t match.' },
  doubleSpaces: { label: (c) => `Doubled spaces in ${c}`, about: 'Two or more spaces in a row inside a value.' },
  nonPrinting: { label: (c) => `Non-printing characters in ${c}`, about: 'Tabs, control characters, zero-width or no-break spaces hidden in the text.' },
  emptyText: { label: (c) => `Empty text in ${c}`, about: 'Values that are text with nothing in it, rather than empty values.' },
  numbersAsText: { label: (c) => `Numbers stored as text in ${c}`, about: 'Read as numbers, they can be summed, sorted and checked.' },
  datesAsText: { label: (c) => `Dates stored as text in ${c}`, about: 'Read as dates, they can be sorted, grouped by month and compared.' },
  mixedCase: { label: (c) => `Mixed capitals in ${c}`, about: 'The same value written with different capitals, so it counts as several.' },
  duplicateRows: { label: () => 'Duplicate rows', about: 'Rows that repeat another row exactly.' },
  placeholders: { label: (c) => `Words for empty in ${c}`, about: 'Values such as n/a, none or a dash that stand for nothing; read as empty, they stop counting as values.' },
  booleansAsText: { label: (c) => `Yes and no stored as text in ${c}`, about: 'Two values from a pair such as Y/N or true/false; read as true and false, they can be filtered and counted.' },
  serialDates: { label: (c) => `Dates stored as numbers in ${c}`, about: 'Excel serial numbers or Unix times in a column named for a date.' },
  mixedTypes: { label: (c, d) => `Mostly ${isStepFix(d.fix) && d.fix.type === 'parseDates' ? 'dates' : 'numbers'} in ${c}, with values that aren’t`, about: 'Most values read as numbers or dates, but some don’t; parsing makes those empty.' },
  nearDuplicate: { label: (c, d) => `${d.value ?? 'A value'} in ${c}, probably ${d.examples[1] ?? 'a misspelling'}`, about: 'A value that is nearly the same as a more common one: a likely misspelling.' },
  inconsistentShapes: { label: (c, d) => `Values written ${d.examples.length > 1 ? `${d.examples.length} ways` : 'several ways'} in ${c}`, about: 'The same kind of value in different shapes: a phone number with and without spaces, a code with and without its prefix.' },
  idDuplicates: { label: (c) => `Repeated values in ${c}`, about: 'A column that looks like an id has values that appear more than once. A Unique rule in the Rules section will keep watch.' },
  untidyNames: { label: () => 'Untidy column names', about: 'Names with spaces at the ends, doubled spaces, hidden characters, or not in the project’s chosen style.' },
  emptyColumn: { label: (c) => `Nothing in ${c}`, about: 'Every value is empty.' },
  constantColumn: { label: (c) => `One value throughout ${c}`, about: 'Every row has the same value, so the column tells nothing apart.' },
  indexColumn: { label: (c) => `Row numbers in ${c}`, about: 'The column counts the rows, as a spreadsheet or pandas export adds; it carries no data.' },
  wideTable: { label: () => 'Months or years as columns', about: 'One column per period: unpivoted, the table can be filtered and charted by period.' },
  keyValue: { label: (c) => `Keys and values together in ${c}`, about: 'Cells such as “Total: 1,234”: split, the key and the value become columns of their own.' },
  mojibake: { label: (c) => `Mangled characters in ${c}`, about: 'Text saved in the wrong encoding: Ã© for é, â€™ for ’.' },
};

export const issueKey = (kind: IssueKind, column?: string, value?: string) => (column == null ? kind : value == null ? `${kind}:${column}` : `${kind}:${column}:${value}`);

export const issueLabel = (issue: Pick<Issue, 'kind' | 'column'> & Partial<Pick<Issue, 'value' | 'examples' | 'fix'>>) => ISSUE_KINDS[issue.kind].label(issue.column, { value: issue.value, examples: issue.examples ?? [], fix: issue.fix });

/** Issues in the order the panel lists them: the table first, then by column in the data's order, then by kind. */
const KIND_ORDER: IssueKind[] = [
  'bannerRows', 'footerRows', 'repeatedHeader', 'narrowRows', 'blankRows', 'totalRows', 'mergedCells', 'skewedRows', 'duplicateRows', 'untidyNames', 'wideTable',
  'emptyColumn', 'mojibake', 'nonPrinting', 'edgeSpaces', 'doubleSpaces', 'emptyText', 'placeholders', 'mixedCase', 'nearDuplicate', 'inconsistentShapes',
  'booleansAsText', 'numbersAsText', 'datesAsText', 'serialDates', 'mixedTypes', 'keyValue', 'idDuplicates', 'indexColumn', 'constantColumn',
];
export function sortIssues(issues: Issue[], columns: string[]): Issue[] {
  const col = (i: Issue) => (i.column == null ? -1 : columns.indexOf(i.column));
  return [...issues].sort((a, b) => col(a) - col(b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.value ?? '').localeCompare(b.value ?? ''));
}
