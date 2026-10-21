import { describe, expect, it } from 'vitest';
import { bigqueryDeclaredType, bigqueryFieldType, convertBigqueryValue, plainValue } from './bigqueryTypes';

describe('BigQuery types', () => {
  it('maps a result field to the loader’s types, repeated fields and records as JSON', () => {
    expect(bigqueryFieldType({ name: 'a', type: 'INTEGER' })).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(bigqueryFieldType({ name: 'a', type: 'INT64' })).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(bigqueryFieldType({ name: 'a', type: 'FLOAT' })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(bigqueryFieldType({ name: 'a', type: 'NUMERIC' })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(38,9)' });
    expect(bigqueryFieldType({ name: 'a', type: 'BIGNUMERIC' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(bigqueryFieldType({ name: 'a', type: 'BOOLEAN' })).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(bigqueryFieldType({ name: 'a', type: 'STRING' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(bigqueryFieldType({ name: 'a', type: 'BYTES' })).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(bigqueryFieldType({ name: 'a', type: 'DATE' })).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(bigqueryFieldType({ name: 'a', type: 'DATETIME' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(bigqueryFieldType({ name: 'a', type: 'TIMESTAMP' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(bigqueryFieldType({ name: 'a', type: 'TIME' })).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(bigqueryFieldType({ name: 'a', type: 'GEOGRAPHY' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(bigqueryFieldType({ name: 'a', type: 'JSON' })).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(bigqueryFieldType({ name: 'a', type: 'RECORD', fields: [] })).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(bigqueryFieldType({ name: 'a', type: 'STRING', mode: 'REPEATED' })).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
  });

  it('maps a declared type with its parameters', () => {
    expect(bigqueryDeclaredType('INT64').sqlType).toBe('BIGINT');
    expect(bigqueryDeclaredType('STRING(10)').sqlType).toBe('VARCHAR');
    expect(bigqueryDeclaredType('NUMERIC').sqlType).toBe('DECIMAL(38,9)');
    expect(bigqueryDeclaredType('NUMERIC(10, 2)').sqlType).toBe('DECIMAL(10,2)');
    expect(bigqueryDeclaredType('BIGNUMERIC(40, 2)').sqlType).toBe('VARCHAR');
    expect(bigqueryDeclaredType('ARRAY<STRING>').sqlType).toBe('JSON');
    expect(bigqueryDeclaredType('STRUCT<city STRING, postcode STRING>').sqlType).toBe('JSON');
    expect(bigqueryDeclaredType('BOOL').sqlType).toBe('BOOLEAN');
  });

  it('unwraps the API’s cells and converts the text values', () => {
    const tags = { name: 'tags', type: 'STRING', mode: 'REPEATED' };
    const shipping = { name: 'shipping', type: 'RECORD', fields: [{ name: 'city', type: 'STRING' }, { name: 'n', type: 'INTEGER' }] };
    expect(plainValue([{ v: 'a' }, { v: 'b' }], tags)).toEqual(['a', 'b']);
    expect(plainValue({ f: [{ v: 'Leeds' }, { v: '2' }] }, shipping)).toEqual({ city: 'Leeds', n: '2' });
    expect(plainValue(null, shipping)).toBeNull();
    expect(convertBigqueryValue(['a', 'b'], tags)).toBe('["a","b"]');
    expect(convertBigqueryValue({ city: 'Leeds' }, shipping)).toBe('{"city":"Leeds"}');
    expect(convertBigqueryValue('42', { name: 'a', type: 'INTEGER' })).toBe(42);
    expect(convertBigqueryValue('9007199254740993', { name: 'a', type: 'INTEGER' })).toBeNull();
    expect(convertBigqueryValue('1.5', { name: 'a', type: 'FLOAT' })).toBe(1.5);
    expect(convertBigqueryValue('NaN', { name: 'a', type: 'FLOAT' })).toBeNaN();
    expect(convertBigqueryValue('true', { name: 'a', type: 'BOOLEAN' })).toBe(true);
    expect(convertBigqueryValue('2024-01-15', { name: 'a', type: 'DATE' })).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(convertBigqueryValue('1.7119638E9', { name: 'a', type: 'TIMESTAMP' })).toBe(Date.UTC(2024, 3, 1, 9, 30));
    expect(convertBigqueryValue('1711963800.5', { name: 'a', type: 'TIMESTAMP' })).toBe(Date.UTC(2024, 3, 1, 9, 30, 0, 500));
    expect(convertBigqueryValue('2024-04-01T09:30:00', { name: 'a', type: 'DATETIME' })).toBe(Date.UTC(2024, 3, 1, 9, 30));
    expect(convertBigqueryValue('aGk=', { name: 'a', type: 'BYTES' })).toEqual(new Uint8Array([104, 105]));
    expect(convertBigqueryValue('19.99', { name: 'a', type: 'NUMERIC' })).toBe('19.99');
    expect(convertBigqueryValue(null, { name: 'a', type: 'STRING' })).toBeNull();
  });
});
