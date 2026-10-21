import { describe, expect, it } from 'vitest';
import { inferFields, inferredType, inferTable, SAMPLE_SIZE } from './inferSchema';

const docs = [
  { _id: 1, name: 'Ada', tags: ['a'], address: { city: 'London', geo: { lat: 1 } }, age: 36 },
  { _id: 2, name: 'Grace', age: 85.5, address: { city: 'New York' } },
  { _id: 3, name: null, when: new Date('2024-01-01') },
];

describe('inferring a schema from documents', () => {
  it('counts each field, how often it is present and the types it held, flattening nested objects to a depth', () => {
    const s = inferFields(docs);
    expect(s.documents).toBe(3);
    const by = Object.fromEntries(s.fields.map((f) => [f.name, f]));
    expect(by._id).toEqual({ name: '_id', present: 3, types: { integer: 3 } });
    expect(by.name).toEqual({ name: 'name', present: 3, types: { string: 2, null: 1 } });
    expect(by.age).toEqual({ name: 'age', present: 2, types: { integer: 1, number: 1 } });
    expect(by['address.city']).toEqual({ name: 'address.city', present: 2, types: { string: 2 } });
    // Depth 2: address.geo is an object, its lat is not opened.
    expect(by['address.geo']).toEqual({ name: 'address.geo', present: 1, types: { object: 1 } });
    expect(by['address.geo.lat']).toBeUndefined();
    // The opened parent is its children, not a field of its own.
    expect(by.address).toBeUndefined();
    expect(by.tags!.types).toEqual({ array: 1 });
    expect(by.when!.types).toEqual({ date: 1 });
  });

  it('names a field’s type from what it held, most seen first', () => {
    expect(inferredType({ name: 'x', present: 2, types: { string: 2 } })).toBe('string');
    expect(inferredType({ name: 'x', present: 3, types: { integer: 1, number: 2 } })).toBe('number or integer');
    expect(inferredType({ name: 'x', present: 1, types: { null: 1 } })).toBe('null');
  });

  it('documents the sample as a table: the id as key, always-present fields not null, a note on the rest, and how many documents it came from', () => {
    const t = inferTable('people', docs, new Date('2026-10-21T10:00:00Z'));
    expect(t.note).toBe('Inferred from 3 documents on 2026-10-21');
    expect(t.columns.find((c) => c.name === '_id')).toMatchObject({ pk: true, unique: true, notNull: true, type: 'integer' });
    expect(t.columns.find((c) => c.name === 'name')).toMatchObject({ pk: false, notNull: false, note: 'null in 33%' });
    expect(t.columns.find((c) => c.name === 'age')).toMatchObject({ notNull: false, note: 'present in 67% of documents' });
    expect(t.columns.find((c) => c.name === 'address.city')!.note).toBe('present in 67% of documents');
  });

  it('reads at most the sample size', () => {
    const many = Array.from({ length: SAMPLE_SIZE + 5 }, (_, i) => ({ id: i }));
    expect(inferFields(many).documents).toBe(SAMPLE_SIZE);
    expect(inferTable('t', [], new Date('2026-10-21')).note).toBe('Inferred from 0 documents on 2026-10-21');
  });
});
