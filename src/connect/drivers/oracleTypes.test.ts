import { describe, expect, it } from 'vitest';
import { convertOracleValue, localText, numberType, oracleColumnType, oracleFieldType } from './oracleTypes';

describe('Oracle types', () => {
  it('holds NUMBER by its precision and scale: integers that fit, decimals otherwise, unconstrained as double', () => {
    expect(numberType(9, 0)).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(numberType(10, 0)).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(numberType(1, 0)).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(numberType(18, 0)).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(numberType(20, 0)).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(20,0)' });
    expect(numberType(10, 2)).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(numberType(undefined, -127)).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(numberType(null, null)).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(numberType(40, 2)).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
  });

  it('maps result columns to the loader’s types', () => {
    expect(oracleFieldType({ name: 'x', dbTypeName: 'NUMBER', precision: 10, scale: 2 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'NUMBER', precision: 0, scale: -127 })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'VARCHAR2', byteSize: 100 })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'DATE' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'TIMESTAMP', scale: 6 })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'TIMESTAMP WITH TIME ZONE' })).toEqual({ type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'TIMESTAMP WITH LOCAL TIME ZONE' }).sqlType).toBe('TIMESTAMP');
    expect(oracleFieldType({ name: 'x', dbTypeName: 'INTERVAL DAY TO SECOND' })).toEqual({ type: 'VARCHAR', sqlType: 'INTERVAL' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'BINARY_FLOAT' })).toEqual({ type: 'DOUBLE', sqlType: 'FLOAT' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'BINARY_DOUBLE' })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'BLOB' })).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'RAW', byteSize: 16 })).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'CLOB' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'JSON' })).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(oracleFieldType({ name: 'x', dbTypeName: 'BOOLEAN' })).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
  });

  it('maps catalogued columns and spells their declarations as Oracle does', () => {
    expect(oracleColumnType({ DATA_TYPE: 'NUMBER', DATA_PRECISION: 10, DATA_SCALE: 0 })).toEqual({ type: 'BIGINT', sqlType: 'BIGINT', declared: 'NUMBER(10,0)' });
    expect(oracleColumnType({ DATA_TYPE: 'NUMBER', DATA_PRECISION: 10, DATA_SCALE: 2 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)', declared: 'NUMBER(10,2)' });
    expect(oracleColumnType({ DATA_TYPE: 'NUMBER', DATA_PRECISION: null, DATA_SCALE: null })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE', declared: 'NUMBER' });
    expect(oracleColumnType({ DATA_TYPE: 'VARCHAR2', DATA_LENGTH: 400, CHAR_LENGTH: 100 })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'VARCHAR2(100)' });
    expect(oracleColumnType({ DATA_TYPE: 'CHAR', DATA_LENGTH: 3, CHAR_LENGTH: 3 }).declared).toBe('CHAR(3)');
    expect(oracleColumnType({ DATA_TYPE: 'TIMESTAMP(6)' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP', declared: 'TIMESTAMP(6)' });
    expect(oracleColumnType({ DATA_TYPE: 'TIMESTAMP(6) WITH TIME ZONE' }).sqlType).toBe('TIMESTAMP WITH TIME ZONE');
    expect(oracleColumnType({ DATA_TYPE: 'DATE' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP', declared: 'DATE' });
    expect(oracleColumnType({ DATA_TYPE: 'RAW', DATA_LENGTH: 16 })).toEqual({ type: 'BLOB', sqlType: 'BLOB', declared: 'RAW(16)' });
    expect(oracleColumnType({ DATA_TYPE: 'CLOB' }).declared).toBe('CLOB');
  });

  it('converts the plain values the client gives', () => {
    expect(convertOracleValue(null, 'VARCHAR')).toBeNull();
    expect(convertOracleValue('101', 'BIGINT')).toBe(101);
    expect(convertOracleValue('99999999999999999999', 'BIGINT')).toBeNull();
    expect(convertOracleValue('5.5', 'VARCHAR')).toBe('5.5');
    expect(convertOracleValue('1.5', 'DOUBLE')).toBe(1.5);
    expect(convertOracleValue('2024-01-15 00:00:00.000', 'TIMESTAMP')).toBe(Date.UTC(2024, 0, 15));
    expect(convertOracleValue('2024-01-15', 'DATE')).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(convertOracleValue('1', 'BOOLEAN')).toBe(true);
    expect(convertOracleValue(new Uint8Array([1, 2]), 'BLOB')).toEqual(new Uint8Array([1, 2]));
    expect(convertOracleValue({ a: 1 }, 'VARCHAR')).toBe('{"a":1}');
  });

  it('writes a Date back as the wall-clock text it was read from', () => {
    expect(localText(new Date(2024, 3, 1, 9, 30, 5, 7))).toBe('2024-04-01 09:30:05.007');
  });
});
