import { describe, expect, it } from 'vitest';
import { inspectorTabs, shownTab } from './tabs';

describe('the inspector’s tabs', () => {
  it('offers Node only while a node is selected', () => {
    expect(inspectorTabs(true).map((t) => t.label)).toEqual(['Node', 'Project', 'Notes']);
    expect(inspectorTabs(false).map((t) => t.label)).toEqual(['Project', 'Notes']);
  });

  it('falls back from Node to Project when nothing is selected, and leaves the other tabs alone', () => {
    expect(shownTab('node', true)).toBe('node');
    expect(shownTab('node', false)).toBe('project');
    expect(shownTab('notes', false)).toBe('notes');
    expect(shownTab('project', true)).toBe('project');
  });
});
