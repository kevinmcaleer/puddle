// Editor form for the Advanced step group.
import { defineStepForm } from './forms';

defineStepForm({
  type: 'customSql',
  title: 'Custom SQL',
  group: 'Advanced',
  fields: [
    {
      key: 'query',
      label: 'Query',
      kind: 'sql',
      placeholder: 'SELECT region, sum(total) AS total\nFROM input\nGROUP BY region',
      hint: 'One DuckDB query over input, the data arriving at this step. Ctrl+Enter applies it. It can’t read files or other tables.',
    },
  ],
  defaults: () => ({ query: 'SELECT *\nFROM input' }),
});
