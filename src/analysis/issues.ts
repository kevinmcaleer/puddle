// The issue catalogue: every kind of problem analysis can find in a node's data, in the user's words, with how
// serious it is and the step that clears it. Detectors (columns.ts) make issues; the Issues panel shows them;
// Fix all turns their fixes into steps.

export type IssueKind = 'edgeSpaces' | 'doubleSpaces' | 'nonPrinting' | 'emptyText' | 'numbersAsText' | 'datesAsText' | 'mixedCase' | 'duplicateRows';

/**
 * `fix`: Fix all applies it without being asked. `suggest`: listed unticked, because applying it could change what
 * a value means (D22). `info`: worth knowing, nothing to apply.
 */
export type IssueSeverity = 'fix' | 'suggest' | 'info';

export interface IssueFix {
  /** The step type that clears the issue. */
  type: string;
  /** Settings the step needs beyond its columns, e.g. the case to change to. */
  params?: Record<string, unknown>;
}

export interface Issue {
  /** Names the issue for ignoring: the kind and the column. */
  key: string;
  kind: IssueKind;
  /** The column, or undefined for an issue about the whole table. */
  column?: string;
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
  /** What was found, with the column: "Spaces at either end of name". */
  label: (column: string | undefined) => string;
  /** The detail line, e.g. what Fix all will do. */
  about: string;
}

export const ISSUE_KINDS: Record<IssueKind, IssueKindDef> = {
  edgeSpaces: { label: (c) => `Spaces at either end of ${c}`, about: 'Values start or end with a space, so equal values don’t match.' },
  doubleSpaces: { label: (c) => `Doubled spaces in ${c}`, about: 'Two or more spaces in a row inside a value.' },
  nonPrinting: { label: (c) => `Non-printing characters in ${c}`, about: 'Tabs, control characters, zero-width or no-break spaces hidden in the text.' },
  emptyText: { label: (c) => `Empty text in ${c}`, about: 'Values that are text with nothing in it, rather than empty values.' },
  numbersAsText: { label: (c) => `Numbers stored as text in ${c}`, about: 'Read as numbers, they can be summed, sorted and checked.' },
  datesAsText: { label: (c) => `Dates stored as text in ${c}`, about: 'Read as dates, they can be sorted, grouped by month and compared.' },
  mixedCase: { label: (c) => `Mixed capitals in ${c}`, about: 'The same value written with different capitals, so it counts as several.' },
  duplicateRows: { label: () => 'Duplicate rows', about: 'Rows that repeat another row exactly.' },
};

export const issueKey = (kind: IssueKind, column?: string) => (column == null ? kind : `${kind}:${column}`);

export const issueLabel = (issue: Pick<Issue, 'kind' | 'column'>) => ISSUE_KINDS[issue.kind].label(issue.column);

/** Issues in the order the panel lists them: the table first, then by column in the data's order, then by kind. */
const KIND_ORDER: IssueKind[] = ['duplicateRows', 'nonPrinting', 'edgeSpaces', 'doubleSpaces', 'emptyText', 'mixedCase', 'numbersAsText', 'datesAsText'];
export function sortIssues(issues: Issue[], columns: string[]): Issue[] {
  const col = (i: Issue) => (i.column == null ? -1 : columns.indexOf(i.column));
  return [...issues].sort((a, b) => col(a) - col(b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
