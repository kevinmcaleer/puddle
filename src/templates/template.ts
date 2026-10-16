// A node template: a Transform node's steps, kept outside any project so every project can reuse them.
import { z } from 'zod';
import { ColumnSchemaZ, FORMAT_VERSION, newId, StepZ, type ColumnSchema, type Step } from '../model';

/**
 * What a template holds: steps and the input columns they read. Never data and never a source: a step's settings
 * are what someone chose, and the columns are names and types only. `formatVersion` follows the project format,
 * and templates upgrade through the same migrations (persistence/templates.ts).
 */
export const TemplateZ = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().default(''),
  formatVersion: z.literal(FORMAT_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(StepZ).min(1),
  /** The input columns the steps read, in the input's order, as they were when the template was saved. */
  expectedColumns: z.array(ColumnSchemaZ).default([]),
});

export type Template = z.infer<typeof TemplateZ>;

/** Step types set up from one table's rows, which a template can't carry: they would hold that table's data. */
export const ROW_BOUND_STEPS: Record<string, string> = { transpose: 'Transpose is set up from one table’s rows, so it can’t go in a template.' };

/** Why a step can't go in a template, or undefined when it can. */
export const notTemplatable = (step: Pick<Step, 'type'>): string | undefined => ROW_BOUND_STEPS[step.type];

/** A step as a template keeps it: where it came from in a project (grouping) and why it was off are left behind. */
function portable(step: Step): Step {
  const { origin: _o, disabledReason: _r, ...rest } = step;
  return rest;
}

export function createTemplate(init: { name: string; description?: string; steps: Step[]; expectedColumns: ColumnSchema[] }, at: Date = new Date()): Template {
  const iso = at.toISOString();
  return TemplateZ.parse({
    id: newId('tpl'),
    name: init.name,
    description: init.description?.trim() ?? '',
    formatVersion: FORMAT_VERSION,
    createdAt: iso,
    updatedAt: iso,
    steps: init.steps.filter((s) => !notTemplatable(s)).map(portable),
    expectedColumns: init.expectedColumns.map(({ name, type }) => ({ name, type })),
  });
}

/** Templates whose name, description or expected columns contain every word of the query. */
export function searchTemplates(templates: Template[], query: string): Template[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return templates;
  return templates.filter((t) => {
    const text = [t.name, t.description, ...t.expectedColumns.map((c) => c.name)].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
