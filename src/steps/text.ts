// Editor forms for the Text step group. Change case and trim live in basic.ts.
import { pickColumns } from './basic';
import { freeName } from './columns';
import { defineStepForm, type DefaultsContext } from './forms';

const oneColumn = (ctx: DefaultsContext) => pickColumns(ctx)[0] ?? ctx.available[0]?.name ?? '';
const mode = (...modes: string[]) => (p: Record<string, unknown>) => modes.includes(String(p.mode));

defineStepForm({
  type: 'findReplace',
  title: 'Find and replace',
  group: 'Text',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns' },
    { key: 'find', label: 'Find', kind: 'text', mono: true },
    { key: 'replace', label: 'Replace with', kind: 'text', mono: true, hint: 'Leave empty to remove what was found.' },
    { key: 'regex', label: 'Use a regular expression', kind: 'switch' },
    { key: 'matchCase', label: 'Match case', kind: 'switch' },
  ],
  defaults: (ctx) => ({ columns: pickColumns(ctx), find: '', replace: '', regex: false, matchCase: true }),
});

defineStepForm({
  type: 'extractText',
  title: 'Extract text',
  group: 'Text',
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    {
      key: 'mode',
      label: 'Extract',
      kind: 'select',
      options: [
        { value: 'prefix', label: 'The first characters' },
        { value: 'suffix', label: 'The last characters' },
        { value: 'between', label: 'Text between two delimiters' },
        { value: 'regex', label: 'A regular expression group' },
      ],
    },
    { key: 'length', label: 'Characters', kind: 'number', min: 1, when: mode('prefix', 'suffix') },
    { key: 'start', label: 'After', kind: 'text', mono: true, when: mode('between') },
    { key: 'end', label: 'Before', kind: 'text', mono: true, when: mode('between') },
    { key: 'pattern', label: 'Pattern', kind: 'text', mono: true, placeholder: '([0-9]+)', when: mode('regex') },
    { key: 'group', label: 'Group', kind: 'number', hint: '1 is the first ( ) in the pattern; 0 is the whole match.', when: mode('regex') },
    { key: 'into', label: 'New column', kind: 'text', mono: true },
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, mode: 'prefix', length: 3, start: '(', end: ')', pattern: '', group: 1, into: freeName(`${column || 'text'}_part`, ctx) };
  },
});

defineStepForm({
  type: 'padText',
  title: 'Pad text',
  group: 'Text',
  fields: [
    { key: 'columns', label: 'Columns', kind: 'columns' },
    { key: 'length', label: 'Pad to', kind: 'number', min: 1, hint: 'Characters. Longer values are left as they are.' },
    { key: 'character', label: 'With', kind: 'text', mono: true },
    {
      key: 'side',
      label: 'At the',
      kind: 'select',
      options: [
        { value: 'start', label: 'Start' },
        { value: 'end', label: 'End' },
      ],
    },
  ],
  defaults: (ctx) => ({ columns: pickColumns(ctx), length: 5, character: '0', side: 'start' }),
});

defineStepForm({
  type: 'textLength',
  title: 'Text length',
  group: 'Text',
  newColumn: true,
  fields: [
    { key: 'column', label: 'Column', kind: 'column' },
    { key: 'into', label: 'New column', kind: 'text', mono: true },
  ],
  defaults: (ctx) => {
    const column = oneColumn(ctx);
    return { column, into: freeName(`${column || 'text'}_length`, ctx) };
  },
});
