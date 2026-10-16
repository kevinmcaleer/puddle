// The editor side of each rule type: its name in the Add rule menu, its form and its defaults.
import { newId, type ColumnSchema, type Rule } from '../model';
import { describeRule, PATTERN_PRESETS, ruleDef, type NodeNames } from '../compiler';
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
export function ruleLabel(rule: Pick<Rule, 'type' | 'params'>, names?: NodeNames): string {
  return describeRule(rule, names) ?? ruleForm(rule.type)?.title ?? rule.type;
}

export const ruleErrors = (rule: Pick<Rule, 'type' | 'params'>) => schemaErrors(ruleDef(rule.type)?.params, rule.params);

export function newRule(type: string, ctx: { selected: string[]; available: ColumnSchema[] }, names?: NodeNames): Rule {
  const form = ruleForm(type);
  if (!form) throw new Error(`Unknown rule type ${type}.`);
  const params = form.defaults(ctx);
  return { id: newId('r'), type, label: ruleLabel({ type, params }, names), enabled: true, severity: 'fail', params };
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
  fields: [
    column,
    {
      key: 'from',
      label: 'Allowed values',
      kind: 'select',
      options: [
        { value: 'list', label: 'A list I type' },
        { value: 'node', label: 'The values of a column of another node' },
      ],
    },
    { key: 'values', label: 'Values', kind: 'list', of: 'text', hint: 'Separated by commas.', when: (p) => p.from !== 'node' },
    { key: 'node', label: 'Node', kind: 'node', when: (p) => p.from === 'node' },
    { key: 'nodeColumn', label: 'Its column', kind: 'nodeColumn', node: 'node', when: (p) => p.from === 'node' },
    { key: 'matchCase', label: 'Match case', kind: 'switch' },
  ],
  defaults: (ctx) => ({ column: first(ctx), from: 'list', values: [], node: '', nodeColumn: '', matchCase: true }),
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
  title: 'Reads as a type',
  fields: [
    column,
    {
      key: 'as',
      label: 'Reads as',
      kind: 'select',
      hint: 'Values are trimmed first; empty values pass.',
      options: [
        { value: 'number', label: 'A number' },
        { value: 'integer', label: 'A whole number' },
        { value: 'decimal', label: 'A decimal number' },
        { value: 'date', label: 'A date' },
        { value: 'boolean', label: 'True or false' },
      ],
    },
  ],
  defaults: (ctx) => ({ column: first(ctx), as: 'number' }),
});

defineRuleForm({
  type: 'length',
  title: 'Length',
  fields: [
    column,
    {
      key: 'op',
      label: 'Length is',
      kind: 'select',
      options: [
        { value: 'exactly', label: 'Exactly' },
        { value: 'atLeast', label: 'At least' },
        { value: 'atMost', label: 'At most' },
      ],
    },
    { key: 'n', label: 'Characters', kind: 'number', min: 0 },
  ],
  defaults: (ctx) => ({ column: first(ctx), op: 'atMost', n: 50 }),
});

defineRuleForm({
  type: 'referential',
  title: 'Exists in another node',
  fields: [
    column,
    { key: 'node', label: 'Exists in node', kind: 'node', hint: 'Every value must be in this node’s column. Empty values pass.' },
    { key: 'nodeColumn', label: 'Its column', kind: 'nodeColumn', node: 'node' },
  ],
  defaults: (ctx) => ({ column: first(ctx), node: '', nodeColumn: '' }),
});

defineRuleForm({
  type: 'expression',
  title: 'Custom expression',
  fields: [{ key: 'expression', label: 'Every row satisfies', kind: 'expression', hint: 'A DuckDB condition, e.g. total >= 0 AND status <> ’void’. A row where it is empty fails.' }],
  defaults: () => ({ expression: '' }),
});

defineRuleForm({
  type: 'rowCount',
  title: 'Row count',
  fields: [
    {
      key: 'mode',
      label: 'Row count',
      kind: 'select',
      options: [
        { value: 'atLeast', label: 'At least a number of rows' },
        { value: 'sameAs', label: 'The same as another node' },
      ],
    },
    { key: 'n', label: 'Rows', kind: 'number', min: 0, when: (p) => p.mode !== 'sameAs' },
    { key: 'node', label: 'Node', kind: 'node', when: (p) => p.mode === 'sameAs' },
  ],
  defaults: () => ({ mode: 'atLeast', n: 1, node: '' }),
});
