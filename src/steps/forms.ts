import { newId, type ColumnSchema, type Step } from '../model';
import { stepDef } from '../compiler';
import type { Detection } from '../dates';
import type { TransposeRowsRead } from '../flow/transpose';
import { columnKind } from '../ui/columnKind';

/** One setting in a step's editor form. The generic form renders these; a step needs no React of its own. */
export type FieldSpec = FieldKind & {
  /** Show the field only when this holds for the step's settings, e.g. one extract mode's options. */
  when?: (params: Record<string, unknown>) => boolean;
  /** For column fields: the type the step needs. Text columns picked here get a pointer to parse dates or parse numbers. */
  expects?: ExpectedKind;
  /** A hint worked out from the settings as they are, shown in place of `hint`, e.g. a format's example. */
  liveHint?: (params: Record<string, unknown>) => string | undefined;
  /** A problem the settings will run into with the step's input columns, shown as a warning before it runs. */
  problem?: (params: Record<string, unknown>, columns: ColumnSchema[]) => string | undefined;
};

/** What a date or number step needs from its columns. */
export type ExpectedKind = 'date' | 'number';

type FieldKind =
  | { key: string; label: string; kind: 'columns'; hint?: string }
  | { key: string; label: string; kind: 'column'; hint?: string }
  | { key: string; label: string; kind: 'text'; hint?: string; mono?: boolean; placeholder?: string }
  | { key: string; label: string; kind: 'number'; hint?: string; min?: number }
  | { key: string; label: string; kind: 'select'; hint?: string; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'switch'; hint?: string }
  | { key: string; label: string; kind: 'renames'; hint?: string }
  /** A comma-separated list of names or whole numbers. */
  | { key: string; label: string; kind: 'list'; of: 'text' | 'number'; hint?: string }
  /** A DuckDB SQL expression, with the step's columns offered for insertion. */
  | { key: string; label: string; kind: 'expression'; hint?: string }
  /** A whole DuckDB query over the step's input, multi-line, with the input's columns offered for insertion. */
  | { key: string; label: string; kind: 'sql'; hint?: string; placeholder?: string }
  /** Filter conditions: column, comparison and value per row. */
  | { key: string; label: string; kind: 'conditions'; hint?: string }
  /** Sort keys: column and direction per row. */
  | { key: string; label: string; kind: 'sortKeys'; hint?: string }
  /** strptime formats tried in order, with detected formats and their match rates offered. */
  | { key: string; label: string; kind: 'dateFormats'; hint?: string }
  /** The pivot editor: field list and four drop zones, editing the whole of the step's settings. */
  | { key: string; label: string; kind: 'pivot'; hint?: string }
  /** How many rows Transpose was set up for, with a way to read them again. */
  | { key: string; label: string; kind: 'transposeRows'; hint?: string };

export type StepGroup = 'Clean' | 'Columns' | 'Rows' | 'Text' | 'Dates' | 'Numbers' | 'Reshape' | 'Advanced';

export interface DefaultsContext {
  /** Columns selected in the results table. */
  selected: string[];
  /** Columns arriving at the step. */
  available: ColumnSchema[];
  /** The first row arriving at the step, as text, for forms that ask for it with `needsFirstRow`. */
  firstRow?: Record<string, string | null>;
  /** Date formats detected on a column, for forms that ask for it with `detectsDates`. */
  dates?: Detection;
  /** The project locale's decimal mark. */
  decimal?: '.' | ',';
  /** The step input's rows as Transpose reads them, for forms that ask for it with `readsRows`. */
  rows?: TransposeRowsRead;
}

/** The editor side of a step type: its name in the Add step menu, its group, its form and its defaults. */
export interface StepForm {
  type: string;
  title: string;
  group: StepGroup;
  fields: FieldSpec[];
  defaults: (ctx: DefaultsContext) => Record<string, unknown>;
  /** Read the step input's first row before choosing defaults (promote headers). */
  needsFirstRow?: boolean;
  /** Detect date formats on the first default column before choosing defaults (parse dates). */
  detectsDates?: boolean;
  /** Read the step input's row count and first column before choosing defaults (transpose). */
  readsRows?: boolean;
}

const FORMS = new Map<string, StepForm>();

export function defineStepForm(form: StepForm): StepForm {
  if (FORMS.has(form.type)) throw new Error(`Step form ${form.type} is defined twice.`);
  if (!stepDef(form.type)) throw new Error(`Step form ${form.type} has no step definition in src/compiler/steps.`);
  FORMS.set(form.type, form);
  return form;
}

export const stepForm = (type: string) => FORMS.get(type);

export const stepForms = () => [...FORMS.values()];

/** The step's label: what the user named it, or what its settings say it does, or its title while incomplete. */
export function labelFor(step: Pick<Step, 'type' | 'params' | 'label' | 'customLabel'>): string {
  if (step.customLabel) return step.label;
  const def = stepDef(step.type);
  const parsed = def?.params.safeParse(step.params);
  if (def && parsed?.success) return def.label(parsed.data);
  return stepForm(step.type)?.title ?? step.label;
}

/** The same step with its label recomputed from its settings, unless it was renamed. */
export const relabel = (step: Step): Step => ({ ...step, label: labelFor(step) });

/** A new step of this type with defaults drawn from the selected columns. */
export function newStep(type: string, ctx: DefaultsContext): Step {
  const form = stepForm(type);
  if (!form) throw new Error(`Unknown step type ${type}.`);
  const params = form.defaults(ctx);
  const step: Step = { id: newId('st'), type, label: form.title, enabled: true, params };
  return { ...step, label: labelFor(step) };
}

/** Field errors from the step's schema, keyed by field, so the form shows them before anything runs. */
export const fieldErrors = (step: Pick<Step, 'type' | 'params'>) => schemaErrors(stepDef(step.type)?.params, step.params);

const PARSE_STEP: Record<ExpectedKind, { step: string; as: string }> = { date: { step: 'Parse dates', as: 'dates' }, number: { step: 'Parse numbers', as: 'numbers' } };

/**
 * When a date or number field is given text columns, what to do about it: read them with parse dates or parse
 * numbers first. Undefined when every picked column is fine, or the field takes any type.
 */
export function textColumnsProblem(field: Pick<FieldSpec, 'expects'>, value: unknown, columns: ColumnSchema[]): string | undefined {
  if (!field.expects) return undefined;
  const picked = Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? [value] : [];
  const text = picked.filter((name) => {
    const c = columns.find((x) => x.name === name);
    return !!c && columnKind(c.type) === 'text';
  });
  if (!text.length) return undefined;
  const { step, as } = PARSE_STEP[field.expects];
  return `${text.join(', ')} ${text.length === 1 ? 'is' : 'are'} text. Add a ${step} step before this one to read ${text.length === 1 ? 'it' : 'them'} as ${as}.`;
}

/** Errors from a params schema, keyed by field, as sentences. */
export function schemaErrors(schema: { safeParse: (v: unknown) => { success: true } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } } | undefined, params: unknown): Record<string, string> {
  const parsed = schema?.safeParse(params);
  if (!parsed || parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    out[key] ??= issue.message.charAt(0).toUpperCase() + issue.message.slice(1) + (issue.message.endsWith('.') ? '' : '.');
  }
  return out;
}
