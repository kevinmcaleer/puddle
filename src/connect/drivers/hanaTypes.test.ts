import { describe, expect, it } from 'vitest';
import { codeName, convertHanaValue, hanaColumnType, hanaFieldType, hanaNamedType } from './hanaTypes';

describe('SAP HANA types', () => {
  it('maps named types to DuckDB’s: integers, exact decimals (floating ones to doubles), dates, times and text', () => {
    expect(hanaNamedType('INTEGER')).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(hanaNamedType('BIGINT')).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(hanaNamedType('DECIMAL', 10, 2)).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(hanaNamedType('DECIMAL')).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(hanaNamedType('DECIMAL', 40, 2)).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(hanaNamedType('SMALLDECIMAL')).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(hanaNamedType('BOOLEAN')).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(hanaNamedType('DATE')).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(hanaNamedType('SECONDDATE')).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(hanaNamedType('TIME')).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(hanaNamedType('VARBINARY')).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(hanaNamedType('NVARCHAR')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(hanaNamedType('ST_POINT')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
  });

  it('names the protocol’s type codes and types a result column by them', () => {
    expect([3, 4, 5, 11, 28, 61, 63, 99].map(codeName)).toEqual(['INTEGER', 'BIGINT', 'DECIMAL', 'NVARCHAR', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'TYPE99']);
    expect(hanaFieldType({ name: 'x', dataType: 5, length: 10, fraction: 2 }).sqlType).toBe('DECIMAL(10,2)');
    expect(hanaFieldType({ name: 'x', dataType: 61 }).sqlType).toBe('TIMESTAMP');
    expect(hanaFieldType({ name: 'x', dataType: 99 }).sqlType).toBe('VARCHAR');
  });

  it('writes a catalogue column’s declared type, lengths and scales as text or numbers', () => {
    expect(hanaColumnType({ DATA_TYPE_NAME: 'DECIMAL', LENGTH: '10', SCALE: '2' })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)', declared: 'DECIMAL(10,2)' });
    expect(hanaColumnType({ DATA_TYPE_NAME: 'NVARCHAR', LENGTH: 255 }).declared).toBe('NVARCHAR(255)');
    expect(hanaColumnType({ DATA_TYPE_NAME: 'INTEGER', LENGTH: 10, SCALE: 0 }).declared).toBe('INTEGER');
    expect(hanaColumnType({ DATA_TYPE_NAME: 'DECIMAL', LENGTH: null, SCALE: null })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE', declared: 'DECIMAL' });
  });

  it('converts node-hdb’s values: dates and timestamps from text, decimals kept as text, big integers, booleans and bytes', () => {
    expect(convertHanaValue('2024-01-15', 'DATE')).toBe(19737);
    expect(convertHanaValue('2024-04-01T09:30:00.0000000', 'TIMESTAMP')).toBe(Date.parse('2024-04-01T09:30:00Z'));
    expect(convertHanaValue('2024-04-01 09:30:00', 'TIMESTAMP')).toBe(Date.parse('2024-04-01T09:30:00Z'));
    expect(convertHanaValue('19.99', 'VARCHAR')).toBe('19.99');
    expect(convertHanaValue('9007199254740993', 'BIGINT')).toBe(9007199254740992);
    expect(convertHanaValue(12n, 'BIGINT')).toBe(12);
    expect(convertHanaValue(true, 'BIGINT')).toBe(1);
    expect(convertHanaValue('1', 'BOOLEAN')).toBe(true);
    expect(convertHanaValue(0, 'BOOLEAN')).toBe(false);
    expect(convertHanaValue('x', 'DOUBLE')).toBeNull();
    expect(convertHanaValue('nope', 'DATE')).toBeNull();
    expect(convertHanaValue(new Uint8Array([1]), 'BLOB')).toEqual(new Uint8Array([1]));
    expect(convertHanaValue(new Uint8Array([255]), 'VARCHAR')).toBe('0xff');
    expect(convertHanaValue({ a: 1 }, 'VARCHAR')).toBe('{"a":1}');
    expect(convertHanaValue(null, 'VARCHAR')).toBeNull();
  });
});
