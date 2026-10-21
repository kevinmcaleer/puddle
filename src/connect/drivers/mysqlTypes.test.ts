import { describe, expect, it } from 'vitest';
import { convertMysqlValue, decimalPrecision, enumValues, mysqlColumnType, mysqlDateDays, mysqlFieldType, mysqlTimestampMs, TYPE_CODES, UNSIGNED_FLAG } from './mysqlTypes';

const field = (columnType: number, extra: Partial<Parameters<typeof mysqlFieldType>[0]> = {}) => ({ name: 'x', columnType, columnLength: 11, flags: 0, decimals: 0, ...extra });

describe('the MySQL family types', () => {
  it('maps a result field by its type code, length and flags', () => {
    expect(mysqlFieldType(field(TYPE_CODES.TINY, { columnLength: 1 }))).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(mysqlFieldType(field(TYPE_CODES.TINY, { columnLength: 4 })).sqlType).toBe('SMALLINT');
    expect(mysqlFieldType(field(TYPE_CODES.LONG)).sqlType).toBe('INTEGER');
    expect(mysqlFieldType(field(TYPE_CODES.LONG, { flags: UNSIGNED_FLAG })).sqlType).toBe('BIGINT');
    expect(mysqlFieldType(field(TYPE_CODES.LONGLONG)).sqlType).toBe('BIGINT');
    expect(mysqlFieldType(field(TYPE_CODES.FLOAT)).sqlType).toBe('FLOAT');
    expect(mysqlFieldType(field(TYPE_CODES.DOUBLE)).sqlType).toBe('DOUBLE');
    expect(mysqlFieldType(field(TYPE_CODES.NEWDECIMAL, { columnLength: 12, decimals: 2 }))).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(mysqlFieldType(field(TYPE_CODES.NEWDECIMAL, { columnLength: 11, decimals: 2, flags: UNSIGNED_FLAG })).sqlType).toBe('DECIMAL(10,2)');
    expect(mysqlFieldType(field(TYPE_CODES.DATE))).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(mysqlFieldType(field(TYPE_CODES.DATETIME))).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(mysqlFieldType(field(TYPE_CODES.TIMESTAMP)).sqlType).toBe('TIMESTAMP');
    expect(mysqlFieldType(field(TYPE_CODES.TIME))).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(mysqlFieldType(field(TYPE_CODES.JSON)).sqlType).toBe('JSON');
    expect(mysqlFieldType(field(TYPE_CODES.VAR_STRING, { characterSet: 45 }))).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(mysqlFieldType(field(TYPE_CODES.BLOB, { characterSet: 63 }))).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(mysqlFieldType(field(TYPE_CODES.BLOB, { characterSet: 45 })).sqlType).toBe('VARCHAR');
    expect(mysqlFieldType(field(TYPE_CODES.BIT, { columnLength: 1 })).type).toBe('BOOLEAN');
    expect(mysqlFieldType(field(TYPE_CODES.YEAR)).sqlType).toBe('SMALLINT');
    expect(mysqlFieldType(field(TYPE_CODES.ENUM)).sqlType).toBe('VARCHAR');
    expect(decimalPrecision({ columnLength: 12, decimals: 2, flags: 0 })).toEqual({ precision: 10, scale: 2 });
  });

  it('maps an information_schema column by its names', () => {
    expect(mysqlColumnType({ DATA_TYPE: 'tinyint', COLUMN_TYPE: 'tinyint(1)' }).type).toBe('BOOLEAN');
    expect(mysqlColumnType({ DATA_TYPE: 'tinyint', COLUMN_TYPE: 'tinyint(4)' }).sqlType).toBe('SMALLINT');
    expect(mysqlColumnType({ DATA_TYPE: 'int', COLUMN_TYPE: 'int(11)' }).sqlType).toBe('INTEGER');
    expect(mysqlColumnType({ DATA_TYPE: 'int', COLUMN_TYPE: 'int(10) unsigned' }).sqlType).toBe('BIGINT');
    expect(mysqlColumnType({ DATA_TYPE: 'decimal', COLUMN_TYPE: 'decimal(10,2)', NUMERIC_PRECISION: '10', NUMERIC_SCALE: '2' }).sqlType).toBe('DECIMAL(10,2)');
    expect(mysqlColumnType({ DATA_TYPE: 'datetime', COLUMN_TYPE: 'datetime' }).sqlType).toBe('TIMESTAMP');
    expect(mysqlColumnType({ DATA_TYPE: 'enum', COLUMN_TYPE: "enum('a','b')" }).sqlType).toBe('VARCHAR');
    expect(mysqlColumnType({ DATA_TYPE: 'varbinary', COLUMN_TYPE: 'varbinary(16)' }).sqlType).toBe('BLOB');
    expect(mysqlColumnType({ DATA_TYPE: 'json', COLUMN_TYPE: 'json' }).sqlType).toBe('JSON');
    expect(mysqlColumnType({ DATA_TYPE: 'time', COLUMN_TYPE: 'time' }).sqlType).toBe('VARCHAR');
  });

  it('converts text and bytes into each column type, with zero dates as null', () => {
    expect(convertMysqlValue('42', 'BIGINT')).toBe(42);
    expect(convertMysqlValue('1', 'BOOLEAN')).toBe(true);
    expect(convertMysqlValue('0', 'BOOLEAN')).toBe(false);
    expect(convertMysqlValue(new Uint8Array([1]), 'BOOLEAN')).toBe(true);
    expect(convertMysqlValue(new Uint8Array([1, 0]), 'BIGINT')).toBe(256);
    expect(convertMysqlValue('2024-04-01 09:30:00', 'TIMESTAMP')).toBe(Date.UTC(2024, 3, 1, 9, 30));
    expect(mysqlTimestampMs('0000-00-00 00:00:00')).toBeNull();
    expect(mysqlTimestampMs('2024-00-10 00:00:00')).toBeNull();
    expect(mysqlDateDays('2024-01-15')).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(mysqlDateDays('0000-00-00')).toBeNull();
    expect(convertMysqlValue(new Uint8Array([1, 2]), 'BLOB')).toEqual(new Uint8Array([1, 2]));
    expect(convertMysqlValue('abc', 'BLOB')).toEqual(new TextEncoder().encode('abc'));
    expect(convertMysqlValue(null, 'VARCHAR')).toBeNull();
  });

  it('reads the values of an ENUM or SET column', () => {
    expect(enumValues("enum('placed','shipped','returned')")).toEqual(['placed', 'shipped', 'returned']);
    expect(enumValues("set('a','b''c')")).toEqual(['a', "b'c"]);
    expect(enumValues('varchar(10)')).toBeUndefined();
  });
});
