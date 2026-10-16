// Quality rules: expectations about a node's output, compiled to one predicate per rule (true passes).
import { z } from 'zod';
import type { Rule } from '../model';
import { CompileError } from './errors';
import { ident, list, num, str } from './sql';
import { expressionProblem } from './steps/columns';

/** What a rule may read besides its own node's rows. */
export interface RuleContext {
  /** Another node's rows on the full data, as a parenthesised subquery; throws CompileError when it can't run. */
  relation: (nodeId: string) => string;
}

/** Names other nodes for labels; undefined when it isn't known (e.g. the node was deleted). */
export type NodeNames = (nodeId: string) => string | undefined;

export interface RuleDef<P> {
  type: string;
  params: z.ZodType<P>;
  /** The rule written as the expectation, e.g. "No leading or trailing spaces in name". */
  label: (params: P, names: NodeNames) => string;
  /** The columns the rule checks, for highlighting failing cells. */
  columns: (params: P) => string[];
  /**
   * A SQL boolean; true passes. For a row rule it is checked on every row of the node's output, and empty values
   * pass unless the rule is about them. For a table rule it is a check on the whole output, where `count(*)` is
   * its row count.
   */
  predicate: (params: P, ctx: RuleContext) => string;
  /** 'row' (the default) or 'table': a table rule has no failing rows to show, only a pass or a fail. */
  scope?: 'row' | 'table';
  /** Other nodes the rule reads: it re-runs when they change, runs as its own query, and the canvas draws the reference. */
  refs?: (params: P) => string[];
}

/** For rules read without a project: one that reads another node can't be compiled this way. */
const NO_CONTEXT: RuleContext = {
  relation: () => {
    throw new CompileError('This rule reads another node, so it is checked with the project.');
  },
};

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

export const rulePredicate = (rule: Pick<Rule, 'type' | 'params' | 'label'>, ctx: RuleContext = NO_CONTEXT) => {
  const { def, params } = ruleParams(rule);
  return def.predicate(params, ctx);
};

const parsed = (rule: Pick<Rule, 'type' | 'params'>) => {
  const def = REGISTRY.get(rule.type);
  const p = def?.params.safeParse(rule.params);
  return def && p?.success ? { def, params: p.data } : undefined;
};

/** Whether a rule checks rows (and so has failing rows to show) or the whole table. */
export const ruleScope = (rule: Pick<Rule, 'type'>): 'row' | 'table' => REGISTRY.get(rule.type)?.scope ?? 'row';

/** The other nodes a rule reads, by id; none while its settings are incomplete. */
export function ruleRefs(rule: Pick<Rule, 'type' | 'params'>): string[] {
  const p = parsed(rule);
  return p?.def.refs ? p.def.refs(p.params).filter(Boolean) : [];
}

/** The rule written as an expectation, naming the nodes it reads; undefined while its settings are incomplete. */
export function describeRule(rule: Pick<Rule, 'type' | 'params'>, names: NodeNames = () => undefined): string | undefined {
  const p = parsed(rule);
  return p ? p.def.label(p.params, names) : undefined;
}

export const ruleColumns = (rule: Pick<Rule, 'type' | 'params' | 'label'>): string[] => {
  const p = parsed(rule);
  return p ? p.def.columns(p.params) : [];
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

const NodeId = z.string().min(1, 'pick a node');
const nameOf = (names: NodeNames, id: string) => names(id) ?? 'a node that no longer exists';
/** The non-empty values of another node's column, as a subquery. */
const valuesOf = (ctx: RuleContext, node: string, column: string, as: (v: string) => string = (v) => v) =>
  `(SELECT ${as(ident(column))} FROM ${ctx.relation(node)} WHERE ${ident(column)} IS NOT NULL)`;

export const inSet = defineRule({
  type: 'inSet',
  params: z
    .object({
      column: Column,
      /** A typed list of values, or the values of a column of another node. */
      from: z.enum(['list', 'node']).default('list'),
      values: z.array(z.string()).default([]),
      node: z.string().default(''),
      nodeColumn: z.string().default(''),
      matchCase: z.boolean().default(true),
    })
    .superRefine((p, ctx) => {
      if (p.from === 'list' && !p.values.length) ctx.addIssue({ code: 'custom', path: ['values'], message: 'list the allowed values' });
      if (p.from === 'node' && !p.node) ctx.addIssue({ code: 'custom', path: ['node'], message: 'pick a node' });
      if (p.from === 'node' && !p.nodeColumn) ctx.addIssue({ code: 'custom', path: ['nodeColumn'], message: 'pick a column' });
    }),
  label: (p, names) =>
    p.from === 'node'
      ? `${p.column} is one of the values of ${nameOf(names, p.node)}.${p.nodeColumn}`
      : `${p.column} is one of ${p.values.slice(0, 3).join(', ')}${p.values.length > 3 ? ` and ${p.values.length - 3} more` : ''}`,
  columns: (p) => [p.column],
  refs: (p) => (p.from === 'node' ? [p.node] : []),
  predicate: (p, ctx) => {
    // Compared as text, like the typed list.
    const fold = (v: string) => (p.matchCase ? `CAST(${v} AS VARCHAR)` : `lower(CAST(${v} AS VARCHAR))`);
    const allowed = p.from === 'node' ? valuesOf(ctx, p.node, p.nodeColumn, fold) : `(${list(p.values.map((v) => str(p.matchCase ? v : v.toLowerCase())))})`;
    return `${ident(p.column)} IS NULL OR ${fold(ident(p.column))} IN ${allowed}`;
  },
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

/** How text is read as each type. Values are trimmed first, and empty values pass. */
const READS_AS = {
  number: { label: 'a number', test: (v: string) => `TRY_CAST(${v} AS DOUBLE) IS NOT NULL` },
  // TRY_CAST to an integer rounds 1.5, so whole numbers are matched first.
  integer: { label: 'a whole number', test: (v: string) => `regexp_full_match(${v}, '[+-]?[0-9]+') AND TRY_CAST(${v} AS HUGEINT) IS NOT NULL` },
  // Digits with an optional point: no exponent, nan or inf, which DOUBLE accepts.
  decimal: { label: 'a decimal number', test: (v: string) => `regexp_full_match(${v}, '[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)')` },
  date: { label: 'a date', test: (v: string) => `TRY_CAST(${v} AS DATE) IS NOT NULL` },
  boolean: { label: 'true or false', test: (v: string) => `TRY_CAST(${v} AS BOOLEAN) IS NOT NULL` },
} as const;
export type ReadsAs = keyof typeof READS_AS;
export const READS_AS_TYPES = Object.keys(READS_AS) as [ReadsAs, ...ReadsAs[]];

export const readsAs = defineRule({
  type: 'readsAs',
  params: z.object({ column: Column, as: z.enum(READS_AS_TYPES).default('number') }),
  label: (p) => `${p.column} reads as ${READS_AS[p.as].label}`,
  columns: (p) => [p.column],
  // Read the way profiling reads text: trimmed, and empty values pass.
  predicate: (p) => `${blank(p.column)} OR (${READS_AS[p.as].test(`trim(${text(p.column)})`)})`,
});

const LENGTH_OPS = { exactly: '=', atLeast: '>=', atMost: '<=' } as const;
const LENGTH_WORDS = { exactly: 'exactly', atLeast: 'at least', atMost: 'at most' } as const;

export const length = defineRule({
  type: 'length',
  params: z.object({
    column: Column,
    op: z.enum(['exactly', 'atLeast', 'atMost']).default('atMost'),
    n: z.number({ message: 'give a number of characters' }).int('give a whole number').min(0, 'give 0 or more'),
  }),
  label: (p) => `${p.column} is ${LENGTH_WORDS[p.op]} ${p.n} ${p.n === 1 ? 'character' : 'characters'}`,
  columns: (p) => [p.column],
  predicate: (p) => `${ident(p.column)} IS NULL OR length(${text(p.column)}) ${LENGTH_OPS[p.op]} ${num(p.n)}`,
});

export const expression = defineRule({
  type: 'expression',
  params: z.object({
    expression: z
      .string()
      .trim()
      .min(1, 'write an expression')
      .superRefine((e, ctx) => {
        const problem = expressionProblem(e);
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
      }),
  }),
  label: (p) => `Every row: ${p.expression}`,
  columns: () => [],
  // Written by hand, so empty values aren't excused: a row where it comes out empty fails.
  predicate: (p) => `(${p.expression})`,
});

/** Every value of a column exists in a column of another node: "every customer_id exists in Customers". */
export const referential = defineRule({
  type: 'referential',
  params: z.object({ column: Column, node: NodeId, nodeColumn: z.string().min(1, 'pick a column') }),
  label: (p, names) => `Every ${p.column} exists in ${nameOf(names, p.node)}.${p.nodeColumn}`,
  columns: (p) => [p.column],
  refs: (p) => [p.node],
  // Compared as values, so 7 matches 7.0; empty values pass ("never empty" is its own rule).
  predicate: (p, ctx) => `${ident(p.column)} IS NULL OR ${ident(p.column)} IN ${valuesOf(ctx, p.node, p.nodeColumn)}`,
});

export const rowCount = defineRule({
  type: 'rowCount',
  params: z
    .object({ mode: z.enum(['atLeast', 'sameAs']).default('atLeast'), n: z.number().int('give a whole number').min(0, 'give 0 or more').optional(), node: z.string().default('') })
    .superRefine((p, ctx) => {
      if (p.mode === 'atLeast' && p.n == null) ctx.addIssue({ code: 'custom', path: ['n'], message: 'give a number of rows' });
      if (p.mode === 'sameAs' && !p.node) ctx.addIssue({ code: 'custom', path: ['node'], message: 'pick a node' });
    }),
  label: (p, names) => (p.mode === 'sameAs' ? `Same number of rows as ${nameOf(names, p.node)}` : `At least ${p.n} ${p.n === 1 ? 'row' : 'rows'}`),
  columns: () => [],
  scope: 'table',
  refs: (p) => (p.mode === 'sameAs' ? [p.node] : []),
  predicate: (p, ctx) => (p.mode === 'sameAs' ? `count(*) = (SELECT count(*) FROM ${ctx.relation(p.node)})` : `count(*) >= ${num(p.n ?? 0)}`),
});
