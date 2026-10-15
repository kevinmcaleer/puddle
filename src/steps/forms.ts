import { newId, type ColumnSchema, type Step } from '../model';
import { stepDef } from '../compiler';

/** One setting in a step's editor form. The generic form renders these; a step needs no React of its own. */
export type FieldSpec =
  | { key: string; label: string; kind: 'columns'; hint?: string }
  | { key: string; label: string; kind: 'column'; hint?: string }
  | { key: string; label: string; kind: 'text'; hint?: string; mono?: boolean; placeholder?: string }
  | { key: string; label: string; kind: 'number'; hint?: string; min?: number }
  | { key: string; label: string; kind: 'select'; hint?: string; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'switch'; hint?: string }
  | { key: string; label: string; kind: 'renames'; hint?: string };

export type StepGroup = 'Clean' | 'Columns' | 'Rows' | 'Text' | 'Dates';

export interface DefaultsContext {
  /** Columns selected in the results table. */
  selected: string[];
  /** Columns arriving at the step. */
  available: ColumnSchema[];
}

/** The editor side of a step type: its name in the Add step menu, its group, its form and its defaults. */
export interface StepForm {
  type: string;
  title: string;
  group: StepGroup;
  fields: FieldSpec[];
  defaults: (ctx: DefaultsContext) => Record<string, unknown>;
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
