import { describe, expect, it } from 'vitest';
import { STEP_GROUPS, stepForm, stepForms } from './index';

describe('step groups', () => {
  it('every step is in one of the groups the menus list, and the type-changing steps share Change type', () => {
    for (const f of stepForms()) expect(STEP_GROUPS, f.type).toContain(f.group);
    expect(['changeType', 'parseDates', 'parseNumbers'].map((t) => stepForm(t)!.group)).toEqual(['Change type', 'Change type', 'Change type']);
  });

  it('the steps that add a column say so, and no other does', () => {
    const adds = stepForms()
      .filter((f) => f.newColumn)
      .map((f) => f.type)
      .sort();
    expect(adds).toEqual(['addColumn', 'addIndex', 'dateDifference', 'duplicateColumn', 'extractDatePart', 'textLength']);
  });
});
