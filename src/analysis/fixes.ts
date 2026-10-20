// From the issues a user chose to fix to the steps that fix them: one step per fix type (Trim on every column that
// needs it, not one Trim per column), in the order the fixes should run.
import { decimalFor } from '../quickfix/fixes';
import type { Detection } from '../dates';
import type { ColumnSchema, Step } from '../model';
import { newStep, relabel, stepForm } from '../steps';
import type { Issue } from './issues';

export interface FixContext {
  available: ColumnSchema[];
  locale: string;
  /** Detect date formats on a column, for Parse dates. */
  detectDates?: (column: string) => Promise<Detection | undefined>;
}

/** The order fixes run in: hidden characters first (so trims see them gone), duplicates last (once values agree). */
const ORDER = ['removeNonPrinting', 'trimWhitespace', 'collapseSpaces', 'emptyToNull', 'changeCase', 'parseNumbers', 'parseDates', 'duplicateRows'];

/** Issues of the same fix type (and settings) share one step: a changeCase to title and one to upper stay apart. */
const groupKey = (issue: Issue) => `${issue.fix!.type}:${JSON.stringify(issue.fix!.params ?? {})}`;

/** The steps that fix these issues, in order, each over every column its issues name. */
export async function planFixes(issues: Issue[], ctx: FixContext): Promise<Step[]> {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (!issue.fix) continue;
    const k = groupKey(issue);
    groups.set(k, [...(groups.get(k) ?? []), issue]);
  }
  const sorted = [...groups.values()].sort((a, b) => ORDER.indexOf(a[0]!.fix!.type) - ORDER.indexOf(b[0]!.fix!.type));
  const steps: Step[] = [];
  for (const group of sorted) {
    const { type, params = {} } = group[0]!.fix!;
    const columns = group.map((i) => i.column).filter((c): c is string => c != null);
    let extra: Record<string, unknown> = { ...params };
    if (type === 'parseDates') {
      // Detected on the first column; the formats that together read it. An ambiguous day and month order leaves them for the user to settle in the step.
      const detection = columns[0] && ctx.detectDates ? await ctx.detectDates(columns[0]) : undefined;
      extra = { ...extra, formats: detection?.formats ?? [] };
    }
    const step = newStep(type, { selected: columns, available: ctx.available, decimal: decimalFor(ctx.locale), locale: ctx.locale });
    steps.push(relabel({ ...step, params: { ...step.params, ...(columns.length ? { columns } : {}), ...extra } }));
  }
  return steps;
}

/** Which issues Fix all applies without being asked: every `fix`, and the suggestions too when the project says so. */
export const defaultTicked = (issues: Issue[], suggestions: boolean) => issues.filter((i) => i.fix && (i.severity === 'fix' || (suggestions && i.severity === 'suggest'))).map((i) => i.key);

/** The group the fix's step files under, as the Add menu groups steps; "Rows" for duplicates. */
export const fixGroup = (issue: Issue): string | undefined => (issue.fix ? stepForm(issue.fix.type)?.group : undefined);
