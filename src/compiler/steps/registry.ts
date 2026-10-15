import type { z } from 'zod';
import type { Step } from '../../model';
import { CompileError } from '../errors';

export interface StepContext {
  /** The CTE holding this step's input. */
  input: string;
}

/**
 * One step type. Adding a step type means one of these (schema, label, compile), one editor form and one
 * test fixture. compile returns a SELECT over ctx.input.
 */
export interface StepDef<P> {
  type: string;
  params: z.ZodType<P>;
  /** Past-tense label naming the columns, e.g. "Trimmed customer_name". */
  label: (params: P) => string;
  compile: (params: P, ctx: StepContext) => string;
}

const REGISTRY = new Map<string, StepDef<unknown>>();

export function defineStep<P>(def: StepDef<P>): StepDef<P> {
  if (REGISTRY.has(def.type)) throw new Error(`Step type ${def.type} is defined twice.`);
  REGISTRY.set(def.type, def as StepDef<unknown>);
  return def;
}

export function stepDef(type: string): StepDef<unknown> | undefined {
  return REGISTRY.get(type);
}

export const stepTypes = () => [...REGISTRY.keys()];

/** Validate a step's params against its type, throwing CompileError with the reason. */
export function stepParams(step: Step, nodeId?: string): { def: StepDef<unknown>; params: unknown } {
  const def = REGISTRY.get(step.type);
  if (!def) throw new CompileError(`Step "${step.label}" has an unknown type (${step.type}).`, nodeId, step.id);
  const parsed = def.params.safeParse(step.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CompileError(`Step "${step.label}" has invalid settings${issue ? `: ${issue.path.join('.') || 'params'} ${issue.message}` : ''}.`, nodeId, step.id);
  }
  return { def, params: parsed.data };
}
