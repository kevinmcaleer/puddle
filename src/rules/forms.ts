// The editor side of each rule type: its name in the Add rule menu, its form and its defaults.
import { newId, type ColumnSchema, type Rule } from '../model';
import { PATTERN_PRESETS, ruleDef } from '../compiler';
import { schemaErrors, type FieldSpec } from '../steps';

export interface RuleForm {
  type: string;
  title: string;
  fields: FieldSpec[];
  defaults: (ctx: { selected: string[]; available: ColumnSchema[] }) => Record<string, unknown>;
}

const FORMS = new Map<string, RuleForm>();

export function defineRuleForm(form: RuleForm): RuleForm {
  if (!ruleDef(form.type)) throw new Error(`Rule form ${form.type} has no rule definition in src/compiler/rules.ts.`);
  FORMS.set(form.type, form);
  return form;
}

export const ruleForm = (type: string) => FORMS.get(type);
export const ruleForms = () => [...FORMS.values()];

/** The rule written as an expectation, from its settings, or its title while they're incomplete. */
export function ruleLabel(rule: Pick<Rule, 'type' | 'params'>): string {
  const def = ruleDef(rule.type);
  const parsed = def?.params.safeParse(rule.params);
  return def && parsed?.success ? def.label(parsed.data) : (ruleForm(rule.type)?.title ?? rule.type);
}

export const ruleErrors = (rule: Pick<Rule, 'type' | 'params'>) => schemaErrors(ruleDef(rule.type)?.params, rule.params);

export function newRule(type: string, ctx: { selected: string[]; available: ColumnSchema[] }): Rule {
  const form = ruleForm(type);
  if (!form) throw new Error(`Unknown rule type ${type}.`);
  const params = form.defaults(ctx);
  return { id: newId('r'), type, label: ruleLabel({ type, params }), enabled: true, severity: 'fail', params };
}

const first = ({ selected, available }: { selected: string[]; available: ColumnSchema[] }) => selected[0] ?? available[0]?.name ?? '';
const column: FieldSpec = { key: 'column', label: 'Column', kind: 'column' };

defineRuleForm({ type: 'notEmpty', title: 'Never empty', fields: [column], defaults: (ctx) => ({ column: first(ctx) }) });

defineRuleForm({
  type: 'unique',
  title: 'Unique',
  fields: [{ key: 'columns', label: 'Columns', kind: 'columns', hint: 'Pick several to check them together.' }],
  defaults: (ctx) => ({ columns: ctx.selected.length ? ctx.selected : [first(ctx)].filter(Boolean) }),
});

defineRuleForm({
  type: 'matchesPattern',
  title: 'Matches a pattern',
  fields: [
    column,
    {
      key: 'preset',
      label: 'Looks like',
      kind: 'select',
      options: [...Object.entries(PATTERN_PRESETS).map(([value, p]) => ({ value, label: p.label.charAt(0).toUpperCase() + p.label.slice(1) })), { value: 'custom', label: 'My own pattern' }],
    },
    { key: 'pattern', label: 'Pattern', kind: 'text', mono: true, placeholder: '^[A-Z]{2}[0-9]+$', when: (p) => p.preset === 'custom' },
  ],
  defaults: (ctx) => ({ column: first(ctx), preset: 'alphanumeric', pattern: '' }),
});

defineRuleForm({ type: 'noEdgeSpaces', title: 'No leading or trailing spaces', fields: [column], defaults: (ctx) => ({ column: first(ctx) }) });

defineRuleForm({
  type: 'inSet',
  title: 'One of a set of values',
  fields: [column, { key: 'values', label: 'Allowed values', kind: 'list', of: 'text', hint: 'Separated by commas.' }, { key: 'matchCase', label: 'Match case', kind: 'switch' }],
  defaults: (ctx) => ({ column: first(ctx), values: [], matchCase: true }),
});

defineRuleForm({
  type: 'inRange',
  title: 'In a range',
  fields: [
    column,
    { key: 'min', label: 'Lowest', kind: 'text', mono: true, hint: 'A number or a date. Leave empty for no lowest.' },
    { key: 'max', label: 'Highest', kind: 'text', mono: true, hint: 'Leave empty for no highest.' },
  ],
  defaults: (ctx) => ({ column: first(ctx), min: '', max: '' }),
});

defineRuleForm({
  type: 'readsAs',
  title: 'Reads as a number or date',
  fields: [
    column,
    { key: 'as', label: 'Reads as', kind: 'select', options: [{ value: 'number', label: 'A number' }, { value: 'date', label: 'A date' }] },
  ],
  defaults: (ctx) => ({ column: first(ctx), as: 'number' }),
});
