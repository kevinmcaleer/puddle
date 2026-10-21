import { describe, expect, it } from 'vitest';
import { convertFirebirdValue, dateText, FIELD_TYPES, firebirdColumnType, firebirdFieldType, SQL_CODES } from './firebirdTypes';

const field = (type: number, scale = 0, subType: number | null = 0) => ({ alias: 'x', type, scale, subType, length: 8 });

describe('Firebird types', () => {
  it('maps result fields to the loader’s types, with fixed-point numbers as decimals of the storage width', () => {
    expect(firebirdFieldType(field(SQL_CODES.LONG))).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(firebirdFieldType(field(SQL_CODES.SHORT))).toEqual({ type: 'BIGINT', sqlType: 'SMALLINT' });
    expect(firebirdFieldType(field(SQL_CODES.INT64))).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(firebirdFieldType(field(SQL_CODES.INT64, -2))).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(18,2)' });
    expect(firebirdFieldType(field(SQL_CODES.LONG, -3))).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(9,3)' });
    expect(firebirdFieldType(field(SQL_CODES.FLOAT))).toEqual({ type: 'DOUBLE', sqlType: 'FLOAT' });
    expect(firebirdFieldType(field(SQL_CODES.DOUBLE))).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(firebirdFieldType(field(SQL_CODES.DATE))).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(firebirdFieldType(field(SQL_CODES.TIME))).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(firebirdFieldType(field(SQL_CODES.TIMESTAMP))).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(firebirdFieldType(field(SQL_CODES.TIMESTAMP_TZ))).toEqual({ type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' });
    expect(firebirdFieldType(field(SQL_CODES.BOOLEAN))).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(firebirdFieldType(field(SQL_CODES.BLOB, 0, 1))).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(firebirdFieldType(field(SQL_CODES.BLOB, 0, 0))).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(firebirdFieldType(field(SQL_CODES.VARYING, 0, 4))).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
  });

  it('maps catalogued columns and spells their declarations as Firebird does', () => {
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.INT64, SUB_TYPE: 2, FIELD_SCALE: -2, FIELD_PRECISION: 10, FIELD_LENGTH: 8, CHARS: null })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)', declared: 'DECIMAL(10,2)' });
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.LONG, SUB_TYPE: 1, FIELD_SCALE: -1, FIELD_PRECISION: null, FIELD_LENGTH: 4, CHARS: null })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(9,1)', declared: 'NUMERIC(9,1)' });
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.LONG, SUB_TYPE: 0, FIELD_SCALE: 0, FIELD_PRECISION: 0, FIELD_LENGTH: 4, CHARS: null })).toEqual({ type: 'BIGINT', sqlType: 'INTEGER', declared: 'INTEGER' });
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.VARCHAR, SUB_TYPE: 0, FIELD_SCALE: 0, FIELD_PRECISION: null, FIELD_LENGTH: 400, CHARS: 100 })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'VARCHAR(100)' });
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.CHAR, SUB_TYPE: 0, FIELD_SCALE: 0, FIELD_PRECISION: null, FIELD_LENGTH: 3, CHARS: 3 }).declared).toBe('CHAR(3)');
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.BLOB, SUB_TYPE: 1, FIELD_SCALE: 0, FIELD_PRECISION: null, FIELD_LENGTH: 8, CHARS: null })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'BLOB SUB_TYPE TEXT' });
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.BLOB, SUB_TYPE: 0, FIELD_SCALE: 0, FIELD_PRECISION: null, FIELD_LENGTH: 8, CHARS: null }).declared).toBe('BLOB');
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.DOUBLE, SUB_TYPE: null, FIELD_SCALE: 0, FIELD_PRECISION: null, FIELD_LENGTH: 8, CHARS: null }).declared).toBe('DOUBLE PRECISION');
    expect(firebirdColumnType({ FIELD_TYPE: FIELD_TYPES.BOOLEAN, SUB_TYPE: null, FIELD_SCALE: 0, FIELD_PRECISION: null, FIELD_LENGTH: 1, CHARS: null }).sqlType).toBe('BOOLEAN');
  });

  it('converts the plain values the client gives', () => {
    expect(convertFirebirdValue(null, 'VARCHAR')).toBeNull();
    expect(convertFirebirdValue(101, 'BIGINT')).toBe(101);
    expect(convertFirebirdValue('42', 'BIGINT')).toBe(42);
    expect(convertFirebirdValue('99999999999999999999', 'BIGINT')).toBeNull();
    expect(convertFirebirdValue('19.99', 'VARCHAR')).toBe('19.99');
    expect(convertFirebirdValue('2024-01-15', 'DATE')).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(convertFirebirdValue('2024-04-01 09:30:00.000', 'TIMESTAMP')).toBe(Date.UTC(2024, 3, 1, 9, 30));
    expect(convertFirebirdValue(true, 'BOOLEAN')).toBe(true);
    expect(convertFirebirdValue(new Uint8Array([1, 2]), 'BLOB')).toEqual(new Uint8Array([1, 2]));
    expect(convertFirebirdValue(1.5, 'DOUBLE')).toBe(1.5);
  });

  it('writes a Date back as the wall-clock text it was read from', () => {
    const d = new Date(2024, 3, 1, 9, 30, 5, 7);
    expect(dateText(d, 'date')).toBe('2024-04-01');
    expect(dateText(d, 'time')).toBe('09:30:05.007');
    expect(dateText(d, 'timestamp')).toBe('2024-04-01 09:30:05.007');
  });
});
