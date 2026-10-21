import { describe, expect, it } from 'vitest';
import { columnKind, documentsToSheet, documentValue, flattenDocument } from './documents';

describe('documents as rows', () => {
  it('flattens nested objects to a depth, keeping deeper ones, arrays and empty objects as values', () => {
    const doc = { id: 1, address: { city: 'London', geo: { lat: 51.5, lng: -0.1 } }, tags: ['a', 'b'], empty: {}, when: new Date(0) };
    expect(flattenDocument(doc)).toEqual({ id: 1, 'address.city': 'London', 'address.geo': { lat: 51.5, lng: -0.1 }, tags: ['a', 'b'], empty: {}, when: new Date(0) });
    expect(flattenDocument(doc, 3)['address.geo.lat']).toBe(51.5);
    expect(flattenDocument(doc, 1)).toEqual({ id: 1, address: doc.address, tags: ['a', 'b'], empty: {}, when: new Date(0) });
    expect(flattenDocument('not a document')).toEqual({});
  });

  it('types a column from the values it holds: integers widen to doubles, anything else mixed is text', () => {
    expect(columnKind([1, null, 2n])).toBe('BIGINT');
    expect(columnKind([1, 2.5])).toBe('DOUBLE');
    expect(columnKind([1, 'x'])).toBe('VARCHAR');
    expect(columnKind([true, false])).toBe('BOOLEAN');
    expect(columnKind([new Date(0)])).toBe('TIMESTAMP');
    expect(columnKind([{ a: 1 }, ['x']])).toBe('JSON');
    expect(columnKind([new Uint8Array([1])])).toBe('BLOB');
    expect(columnKind([null, undefined])).toBe('VARCHAR');
    expect(columnKind([2 ** 60])).toBe('DOUBLE');
  });

  it('converts a value to what its column takes, text for the mixed', () => {
    expect(documentValue(3n, 'BIGINT')).toBe(3);
    expect(documentValue(new Date('2024-01-01T00:00:00Z'), 'TIMESTAMP')).toBe(1704067200000);
    expect(documentValue({ a: 1 }, 'JSON')).toBe('{"a":1}');
    expect(documentValue({ a: 1 }, 'VARCHAR')).toBe('{"a":1}');
    expect(documentValue(new Date('2024-01-01T00:00:00Z'), 'VARCHAR')).toBe('2024-01-01T00:00:00.000Z');
    expect(documentValue(new Uint8Array([255, 1]), 'VARCHAR')).toBe('0xff01');
    expect(documentValue(new ArrayBuffer(2), 'BLOB')).toEqual(new Uint8Array([0, 0]));
    expect(documentValue('x', 'BIGINT')).toBeNull();
    expect(documentValue(undefined, 'VARCHAR')).toBeNull();
  });

  it('makes sheet columns in the order fields are first seen, null where a document lacks one, JSON crossing as text', () => {
    const { columns, sqlTypes } = documentsToSheet([
      { id: 1, name: 'Ada', address: { city: 'London' }, tags: ['a'] },
      { id: 2, age: 85.5, address: { city: 'New York', geo: { lat: 1 } } },
    ]);
    expect(columns.map((c) => [c.name, c.type])).toEqual([
      ['id', 'BIGINT'],
      ['name', 'VARCHAR'],
      ['address.city', 'VARCHAR'],
      ['tags', 'VARCHAR'],
      ['age', 'DOUBLE'],
      ['address.geo', 'VARCHAR'],
    ]);
    expect(sqlTypes).toEqual(['BIGINT', 'VARCHAR', 'VARCHAR', 'JSON', 'DOUBLE', 'JSON']);
    expect(columns.map((c) => c.values)).toEqual([
      [1, 2],
      ['Ada', null],
      ['London', 'New York'],
      ['["a"]', null],
      [null, 85.5],
      [null, '{"lat":1}'],
    ]);
    expect(documentsToSheet([])).toEqual({ columns: [], sqlTypes: [] });
  });
});
