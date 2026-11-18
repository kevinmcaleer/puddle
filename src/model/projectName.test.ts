import { describe, expect, it } from 'vitest';
import { addSource } from './edits';
import { createProject } from './project';
import { DEFAULT_PROJECT_NAME, freeProjectName, nameAfterFirstSource, sourceProjectName } from './projectName';
import { useProjectStore, setTakenProjectNames } from './store';
import type { Source } from './schema';

const source = (name: string, kind: Source['kind'] = 'file'): Source => ({ id: `s-${name}`, name, kind, format: 'csv', parseOptions: {}, detectedSchema: [] }) as Source;
const at = { x: 0, y: 0 };

describe('the name a project takes from its first source', () => {
  it('drops a file extension, and an archive extension before it', () => {
    expect(sourceProjectName({ name: 'sales.csv' })).toBe('sales');
    expect(sourceProjectName({ name: 'Q3 report.final.xlsx' })).toBe('Q3 report.final');
    expect(sourceProjectName({ name: 'trips.csv.gz' })).toBe('trips');
    expect(sourceProjectName({ name: 'Pasted data' })).toBe('Pasted data');
    expect(sourceProjectName({ name: '.csv' })).toBe('.csv');
  });

  it('keeps a database table as it is named', () => {
    expect(sourceProjectName({ name: 'public.orders', kind: 'connection' })).toBe('public.orders');
  });

  it('takes the next free number when another project has the name', () => {
    expect(freeProjectName('sales', [])).toBe('sales');
    expect(freeProjectName('sales', ['Sales', 'other'])).toBe('sales 2');
    expect(freeProjectName('sales', ['sales', 'sales 2'])).toBe('sales 3');
  });

  it('names an untitled project after its first source only', () => {
    const empty = createProject();
    expect(empty.name).toBe(DEFAULT_PROJECT_NAME);
    const one = addSource(empty, source('sales.csv'), at);
    const named = nameAfterFirstSource(empty, one);
    expect(named.name).toBe('sales');
    // Several files added at once: the first names it, the rest leave it alone.
    const two = addSource(named, source('customers.csv'), at);
    expect(nameAfterFirstSource(named, two).name).toBe('sales');
    const both = addSource(one, source('customers.csv'), at);
    expect(nameAfterFirstSource(empty, both).name).toBe('sales');
  });

  it('never renames a project that was named, or one that already had a source', () => {
    const mine = createProject('Month end');
    expect(nameAfterFirstSource(mine, addSource(mine, source('sales.csv'), at)).name).toBe('Month end');
    const had = addSource(createProject(), source('sales.csv'), at);
    expect(nameAfterFirstSource(had, addSource(had, source('more.csv'), at)).name).toBe(DEFAULT_PROJECT_NAME);
    // An edit that adds no source changes nothing.
    const empty = createProject();
    expect(nameAfterFirstSource(empty, { ...empty, notes: 'x' })).toEqual({ ...empty, notes: 'x' });
  });
});

describe('the store names the project in the step that adds the source', () => {
  it('names it, avoids a name another project has, and undo takes the name back with the source', () => {
    setTakenProjectNames(() => ['sales']);
    const store = useProjectStore.getState();
    store.load(createProject());
    store.apply((p) => addSource(p, source('sales.csv'), at));
    expect(useProjectStore.getState().history.present.name).toBe('sales 2');
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present.name).toBe(DEFAULT_PROJECT_NAME);
    expect(useProjectStore.getState().history.present.sources).toEqual([]);
    setTakenProjectNames(() => []);
  });

  it('names it inside a batch too', () => {
    const store = useProjectStore.getState();
    store.load(createProject());
    store.batch(() => {
      store.apply((p) => addSource(p, source('orders.tsv'), at));
      store.apply((p) => addSource(p, source('customers.csv'), at));
    });
    expect(useProjectStore.getState().history.present.name).toBe('orders');
  });
});
