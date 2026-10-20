// From the issues a user chose to fix to the steps that fix them: one step per fix type (Trim on every column that
// needs it, not one Trim per column), in the order the fixes should run.
import { decimalFor } from '../quickfix/fixes';
import type { Detection } from '../dates';
import type { ColumnSchema, ParseOptions, Step } from '../model';
import { newStep, relabel, stepForm } from '../steps';
import { fixSteps, isReadOptionsFix, isStepFix, isStepsFix, type Issue, type StepFix } from './issues';
import { fixName } from './fixName';

export interface FixContext {
  available: ColumnSchema[];
  locale: string;
  /** Detect date formats on a column, for Parse dates. */
  detectDates?: (column: string) => Promise<Detection | undefined>;
}

/**
 * The order fixes run in: hidden and mangled characters and spaces first (so a padded repeated header matches its
 * names), rows out next, values put right, types changed, duplicates once values agree, then columns removed, split
 * or unpivoted, and renamed last so every step before names the columns as the data had them.
 */
const ORDER = ['removeNonPrinting', 'fixMojibake', 'trimWhitespace', 'collapseSpaces', 'filterRows', 'removeBlankRows', 'emptyToNull', 'replaceValues', 'changeCase', 'findReplace', 'parseNumbers', 'parseDates', 'changeType', 'duplicateRows', 'removeColumns', 'splitByDelimiter', 'unpivot', 'renameColumns'];

/** Issues of the same fix type (and settings) share one step: a changeCase to title and one to upper stay apart. */
const groupKey = (fix: StepFix) => `${fix.type}:${JSON.stringify(fix.params ?? {})}`;

export interface Planned {
  /** The steps, in the order they run. */
  steps: Step[];
  /** Read options to set on the source first (a banner skipped at the top), merged over the ones it has. */
  readOptions: ParseOptions;
}

/** The steps that fix these issues, in order, each over every column its issues name, and the read options to set. */
export async function planFixes(issues: Issue[], ctx: FixContext): Promise<Planned> {
  const groups = new Map<string, { fix: StepFix; columns: string[]; order: number }>();
  let readOptions: ParseOptions = {};
  for (const issue of issues) {
    if (isReadOptionsFix(issue.fix)) {
      // Values to read as empty add up across columns; any other option is set outright.
      const nullStrings = [...new Set([...(readOptions.nullStrings ?? []), ...(issue.fix.readOptions.nullStrings ?? [])])];
      readOptions = { ...readOptions, ...issue.fix.readOptions, ...(nullStrings.length ? { nullStrings } : {}) };
    }
    const steps = fixSteps(issue.fix);
    steps.forEach((fix, k) => {
      const key = groupKey(fix);
      // A fix of several steps keeps them together, in its order, where its first step falls.
      const g = groups.get(key) ?? { fix, columns: [], order: ORDER.indexOf(steps[0]!.type) + k / 100 };
      if (issue.column != null && !g.columns.includes(issue.column)) g.columns.push(issue.column);
      groups.set(key, g);
    });
  }
  const sorted = [...groups.values()].sort((a, b) => a.order - b.order);
  const steps: Step[] = [];
  for (const { fix, columns } of sorted) {
    const { type, params = {} } = fix;
    let extra: Record<string, unknown> = { ...params };
    if (type === 'parseDates' && !params.formats) {
      // Detected on the first column; the formats that together read it. An ambiguous day and month order leaves them for the user to settle in the step.
      const detection = columns[0] && ctx.detectDates ? await ctx.detectDates(columns[0]) : undefined;
      extra = { ...extra, formats: detection?.formats ?? [] };
    }
    const step = newStep(type, { selected: columns, available: ctx.available, decimal: decimalFor(ctx.locale), locale: ctx.locale });
    // The issues' columns, for a step that works on columns; a step that names its own (Rename, Split) keeps its settings.
    steps.push(relabel({ ...step, params: { ...step.params, ...(columns.length && 'columns' in step.params ? { columns } : {}), ...extra } }));
  }
  return { steps, readOptions };
}

/** Which issues Fix all applies without being asked: every `fix`, and the suggestions too when the project says so. */
export const defaultTicked = (issues: Issue[], suggestions: boolean) => issues.filter((i) => i.fix && (i.severity === 'fix' || (suggestions && i.severity === 'suggest'))).map((i) => i.key);

/** The group the fix's step files under, as the Add menu groups steps; "Rows" for duplicates; "Read options" for a skip. */
export const fixGroup = (issue: Issue): string | undefined => (isReadOptionsFix(issue.fix) ? 'Read options' : isStepFix(issue.fix) ? stepForm(issue.fix.type)?.group : isStepsFix(issue.fix) ? stepForm(issue.fix.steps[0]?.type ?? '')?.group : undefined);

/** What the fix does, in the panel's words: the step's title, or the read option change. */
export const fixLabel = (issue: Issue): string | undefined => (isReadOptionsFix(issue.fix) || isStepsFix(issue.fix) ? issue.fix.label : isStepFix(issue.fix) ? fixName(issue.fix.type) : undefined);
