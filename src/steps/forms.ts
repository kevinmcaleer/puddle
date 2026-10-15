import { newId, type ColumnSchema, type Step } from '../model';
import { stepDef } from '../compiler';
import type { Detection } from '../dates';

/** One setting in a step's editor form. The generic form renders these; a step needs no React of its own. */
export type FieldSpec = FieldKind & {
  /** Show the field only when this holds for the step's settings, e.g. one extract mode's options. */
  when?: (params: Record<string, unknown>) => boolean;
};

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
  /** Filter conditions: column, comparison and value per row. */
  | { key: string; label: string; kind: 'conditions'; hint?: string }
  /** Sort keys: column and direction per row. */
  | { key: string; label: string; kind: 'sortKeys'; hint?: string }
  /** strptime formats tried in order, with detected formats and their match rates offered. */
  | { key: string; label: string; kind: 'dateFormats'; hint?: string };

export type StepGroup = 'Clean' | 'Columns' | 'Rows' | 'Text' | 'Dates';

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
export function fieldErrors(step: Pick<Step, 'type' | 'params'>): Record<string, string> {
  const parsed = stepDef(step.type)?.params.safeParse(step.params);
  if (!parsed || parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    out[key] ??= issue.message.charAt(0).toUpperCase() + issue.message.slice(1) + (issue.message.endsWith('.') ? '' : '.');
  }
  return out;
}
