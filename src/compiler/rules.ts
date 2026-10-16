// Quality rules: expectations about a node's output, compiled to one predicate per rule (true passes).
import { z } from 'zod';
import type { Rule } from '../model';
import { CompileError } from './errors';
import { ident, list, str } from './sql';

export interface RuleDef<P> {
  type: string;
  params: z.ZodType<P>;
  /** The rule written as the expectation, e.g. "No leading or trailing spaces in name". */
  label: (params: P) => string;
  /** The columns the rule checks, for highlighting failing cells. */
  columns: (params: P) => string[];
  /** A SQL boolean over the node's output; true passes. Empty values pass unless the rule is about them. */
  predicate: (params: P) => string;
}

const REGISTRY = new Map<string, RuleDef<unknown>>();

export function defineRule<P>(def: RuleDef<P>): RuleDef<P> {
  if (REGISTRY.has(def.type)) throw new Error(`Rule type ${def.type} is defined twice.`);
  REGISTRY.set(def.type, def as RuleDef<unknown>);
  return def;
}

export const ruleDef = (type: string) => REGISTRY.get(type);
export const ruleTypes = () => [...REGISTRY.keys()];

/** Validate a rule's params against its type, throwing CompileError with the reason. */
export function ruleParams(rule: Pick<Rule, 'type' | 'params' | 'label'>): { def: RuleDef<unknown>; params: unknown } {
  const def = REGISTRY.get(rule.type);
  if (!def) throw new CompileError(`Rule "${rule.label}" has an unknown type (${rule.type}).`);
  const parsed = def.params.safeParse(rule.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CompileError(`Rule "${rule.label}" has invalid settings${issue ? `: ${issue.path.join('.') || 'params'} ${issue.message}` : ''}.`);
  }
  return { def, params: parsed.data };
}

export const rulePredicate = (rule: Pick<Rule, 'type' | 'params' | 'label'>) => {
  const { def, params } = ruleParams(rule);
  return def.predicate(params);
};

export const ruleColumns = (rule: Pick<Rule, 'type' | 'params' | 'label'>): string[] => {
  const def = REGISTRY.get(rule.type);
  const parsed = def?.params.safeParse(rule.params);
  return def && parsed?.success ? def.columns(parsed.data) : [];
};

const Column = z.string().min(1, 'pick a column');
const text = (c: string) => `CAST(${ident(c)} AS VARCHAR)`;
const blank = (c: string) => `coalesce(trim(${text(c)}), '') = ''`;

export const notEmpty = defineRule({
  type: 'notEmpty',
  params: z.object({ column: Column }),
  label: (p) => `${p.column} is never empty`,
  columns: (p) => [p.column],
  predicate: (p) => `NOT (${blank(p.column)})`,
});

export const unique = defineRule({
  type: 'unique',
  params: z.object({ columns: z.array(z.string().min(1)).min(1, 'pick at least one column') }),
  label: (p) => (p.columns.length === 1 ? `${p.columns[0]} is unique` : `${p.columns.join(', ')} together are unique`),
  columns: (p) => p.columns,
  // Rows with an empty key aren't duplicates of each other; "never empty" is its own rule.
  predicate: (p) => `(${p.columns.map((c) => `${ident(c)} IS NULL`).join(' OR ')}) OR count(*) OVER (PARTITION BY ${list(p.columns.map(ident))}) = 1`,
});

export const PATTERN_PRESETS = {
  alphanumeric: { label: 'letters and digits only', pattern: '^[A-Za-z0-9]+$' },
  digits: { label: 'digits only', pattern: '^[0-9]+$' },
  email: { label: 'an email address', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
  url: { label: 'a web address', pattern: '^https?://[^\\s/$.?#][^\\s]*$' },
  ukPostcode: { label: 'a UK postcode', pattern: '^[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}$' },
  phone: { label: 'a phone number', pattern: '^\\+?[0-9][0-9 ()-]{5,}[0-9]$' },
} as const;
export type PatternPreset = keyof typeof PATTERN_PRESETS;
const PRESETS = Object.keys(PATTERN_PRESETS) as [PatternPreset, ...PatternPreset[]];

export const matchesPattern = defineRule({
  type: 'matchesPattern',
  params: z
    .object({ column: Column, preset: z.enum([...PRESETS, 'custom']).default('custom'), pattern: z.string().default('') })
    .refine((p) => p.preset !== 'custom' || p.pattern.length > 0, { path: ['pattern'], message: 'give a pattern' }),
  label: (p) => (p.preset === 'custom' ? `${p.column} matches ${p.pattern}` : `${p.column} is ${PATTERN_PRESETS[p.preset].label}`),
  columns: (p) => [p.column],
  predicate: (p) => `${ident(p.column)} IS NULL OR regexp_full_match(${text(p.column)}, ${str(p.preset === 'custom' ? p.pattern : PATTERN_PRESETS[p.preset].pattern)})`,
});

export const noEdgeSpaces = defineRule({
  type: 'noEdgeSpaces',
  params: z.object({ column: Column }),
  label: (p) => `No leading or trailing spaces in ${p.column}`,
  columns: (p) => [p.column],
  predicate: (p) => `${ident(p.column)} IS NULL OR ${text(p.column)} = trim(${text(p.column)})`,
});

export const inSet = defineRule({
  type: 'inSet',
  params: z.object({ column: Column, values: z.array(z.string()).min(1, 'list the allowed values'), matchCase: z.boolean().default(true) }),
  label: (p) => `${p.column} is one of ${p.values.slice(0, 3).join(', ')}${p.values.length > 3 ? ` and ${p.values.length - 3} more` : ''}`,
  columns: (p) => [p.column],
  predicate: (p) =>
    p.matchCase
      ? `${ident(p.column)} IS NULL OR ${text(p.column)} IN (${list(p.values.map(str))})`
      : `${ident(p.column)} IS NULL OR lower(${text(p.column)}) IN (${list(p.values.map((v) => str(v.toLowerCase())))})`,
});

export const inRange = defineRule({
  type: 'inRange',
  params: z
    .object({ column: Column, min: z.string().trim().default(''), max: z.string().trim().default('') })
    .refine((p) => p.min !== '' || p.max !== '', { path: ['min'], message: 'give a lowest or highest value' }),
  label: (p) => (p.min && p.max ? `${p.column} is between ${p.min} and ${p.max}` : p.min ? `${p.column} is at least ${p.min}` : `${p.column} is at most ${p.max}`),
  columns: (p) => [p.column],
  // The bounds are read as the column's type (numbers or dates) by DuckDB.
  predicate: (p) => `${ident(p.column)} IS NULL OR (${[p.min && `${ident(p.column)} >= ${str(p.min)}`, p.max && `${ident(p.column)} <= ${str(p.max)}`].filter(Boolean).join(' AND ')})`,
});

const READS_AS = { number: 'DOUBLE', date: 'DATE' } as const;

export const readsAs = defineRule({
  type: 'readsAs',
  params: z.object({ column: Column, as: z.enum(['number', 'date']).default('number') }),
  label: (p) => `${p.column} reads as ${p.as === 'number' ? 'a number' : 'a date'}`,
  columns: (p) => [p.column],
  // Read the way profiling reads text: trimmed, and empty values pass.
  predicate: (p) => `${blank(p.column)} OR TRY_CAST(trim(${text(p.column)}) AS ${READS_AS[p.as]}) IS NOT NULL`,
});
