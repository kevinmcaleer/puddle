import { describe, expect, it } from 'vitest';
import { byteaBytes, convertValue, dateDays, numericTypmod, pgColumnType, pgDeclaredType, pgFieldType, pgType, timestampMs } from './pgTypes';

describe('the PostgreSQL family types', () => {
  it('maps the integers to their DuckDB sizes and the rest to the types the loader knows', () => {
    expect(pgType({ name: 'int2' })).toEqual({ type: 'BIGINT', sqlType: 'SMALLINT' });
    expect(pgType({ name: 'int4' })).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(pgType({ name: 'int8' })).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(pgType({ name: 'float4' })).toEqual({ type: 'DOUBLE', sqlType: 'FLOAT' });
    expect(pgType({ name: 'float8' })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(pgType({ name: 'bool' })).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(pgType({ name: 'date' })).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(pgType({ name: 'timestamp' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(pgType({ name: 'timestamptz' })).toEqual({ type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' });
    expect(pgType({ name: 'time' })).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(pgType({ name: 'uuid' }).sqlType).toBe('UUID');
    expect(pgType({ name: 'jsonb' }).sqlType).toBe('JSON');
    expect(pgType({ name: 'bytea' })).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(pgType({ name: 'interval' }).sqlType).toBe('INTERVAL');
    // Enums, arrays, user types and money are text.
    expect(pgType({ name: 'order_status' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(pgType({ name: 'money' }).sqlType).toBe('VARCHAR');
    expect(pgType({ name: 'pg_catalog.int4' }).sqlType).toBe('INTEGER');
  });

  it('keeps a NUMERIC with a declared size exact and reads one without as a double', () => {
    expect(pgType({ name: 'numeric', precision: 10, scale: 2 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(pgType({ name: 'numeric' })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(pgType({ name: 'numeric', precision: 60, scale: 2 }).sqlType).toBe('DOUBLE');
    expect(numericTypmod(-1)).toBeUndefined();
    expect(numericTypmod(((10 << 16) | 2) + 4)).toEqual({ precision: 10, scale: 2 });
    expect(pgFieldType(1700, ((10 << 16) | 2) + 4).sqlType).toBe('DECIMAL(10,2)');
    expect(pgFieldType(1700, -1).sqlType).toBe('DOUBLE');
  });

  it('reads a result field by its OID and an information_schema column by its names', () => {
    expect(pgFieldType(23, -1).sqlType).toBe('INTEGER');
    expect(pgFieldType(99999, -1)).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(pgColumnType({ udt_name: 'numeric', numeric_precision: '10', numeric_scale: '2' }).sqlType).toBe('DECIMAL(10,2)');
    expect(pgColumnType({ udt_name: 'numeric', numeric_precision: null, numeric_scale: null }).sqlType).toBe('DOUBLE');
    expect(pgColumnType({ udt_name: '_int4', data_type: 'ARRAY' }).sqlType).toBe('VARCHAR');
    expect(pgDeclaredType({ udt_name: 'numeric', numeric_precision: '10', numeric_scale: '2' })).toBe('numeric(10,2)');
    expect(pgDeclaredType({ udt_name: 'varchar', character_maximum_length: '40' })).toBe('varchar(40)');
    expect(pgDeclaredType({ udt_name: 'bpchar', character_maximum_length: '2' })).toBe('char(2)');
    expect(pgDeclaredType({ udt_name: '_text', data_type: 'ARRAY' })).toBe('text[]');
    expect(pgDeclaredType({ udt_name: 'order_status', data_type: 'USER-DEFINED' })).toBe('order_status');
  });

  it('converts the text the database sends into each column type', () => {
    expect(convertValue('42', 'BIGINT')).toBe(42);
    expect(convertValue('99999999999999999999', 'BIGINT')).toBeNull();
    expect(convertValue('1.5', 'DOUBLE')).toBe(1.5);
    expect(convertValue('NaN', 'DOUBLE')).toBeNaN();
    expect(convertValue('abc', 'DOUBLE')).toBeNull();
    expect(convertValue('t', 'BOOLEAN')).toBe(true);
    expect(convertValue('f', 'BOOLEAN')).toBe(false);
    expect(convertValue('2024-01-15', 'DATE')).toBe(dateDays('2024-01-15'));
    expect(dateDays('1970-01-02')).toBe(1);
    expect(dateDays('infinity')).toBeNull();
    expect(dateDays('0100-01-01 BC')).toBeNull();
    expect(timestampMs('2024-04-01 09:30:00')).toBe(Date.UTC(2024, 3, 1, 9, 30));
    expect(timestampMs('2024-04-01 09:30:00.123456')).toBe(Date.UTC(2024, 3, 1, 9, 30, 0, 123));
    expect(timestampMs('2024-04-01T09:30:00.5')).toBe(Date.UTC(2024, 3, 1, 9, 30, 0, 500));
    expect(timestampMs('-infinity')).toBeNull();
    expect(byteaBytes('\\x0aff')).toEqual(new Uint8Array([10, 255]));
    expect(byteaBytes('abc')).toBeNull();
    expect(convertValue('2024-04-01 09:30:00+00', 'VARCHAR')).toBe('2024-04-01 09:30:00+00');
    expect(convertValue(null, 'BIGINT')).toBeNull();
  });
});
