import { describe, expect, it } from 'vitest';
import { convertSqlserverValue, sqlserverColumnType, sqlserverFieldType, utcText } from './sqlserverTypes';

describe('SQL Server types', () => {
  it('maps result columns to the loader’s types, money as a four-place decimal', () => {
    expect(sqlserverFieldType({ name: 'x', type: 'Int' })).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(sqlserverFieldType({ name: 'x', type: 'IntN', dataLength: 8 })).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(sqlserverFieldType({ name: 'x', type: 'IntN', dataLength: 2 })).toEqual({ type: 'BIGINT', sqlType: 'SMALLINT' });
    expect(sqlserverFieldType({ name: 'x', type: 'BitN' })).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(sqlserverFieldType({ name: 'x', type: 'DecimalN', precision: 10, scale: 2 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(sqlserverFieldType({ name: 'x', type: 'MoneyN', dataLength: 8 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(19,4)' });
    expect(sqlserverFieldType({ name: 'x', type: 'MoneyN', dataLength: 4 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,4)' });
    expect(sqlserverFieldType({ name: 'x', type: 'FloatN', dataLength: 4 })).toEqual({ type: 'DOUBLE', sqlType: 'FLOAT' });
    expect(sqlserverFieldType({ name: 'x', type: 'Date' })).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(sqlserverFieldType({ name: 'x', type: 'DateTime2', scale: 7 })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(sqlserverFieldType({ name: 'x', type: 'DateTimeOffset' })).toEqual({ type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' });
    expect(sqlserverFieldType({ name: 'x', type: 'Time' })).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(sqlserverFieldType({ name: 'x', type: 'UniqueIdentifier' })).toEqual({ type: 'VARCHAR', sqlType: 'UUID' });
    expect(sqlserverFieldType({ name: 'x', type: 'VarBinary' })).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(sqlserverFieldType({ name: 'x', type: 'NVarChar', dataLength: 200 })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(sqlserverFieldType({ name: 'x', type: 'Xml' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
  });

  it('maps catalogued columns and spells their declarations as SQL Server does', () => {
    expect(sqlserverColumnType({ DATA_TYPE: 'int' })).toEqual({ type: 'BIGINT', sqlType: 'INTEGER', declared: 'int' });
    expect(sqlserverColumnType({ DATA_TYPE: 'decimal', NUMERIC_PRECISION: 10, NUMERIC_SCALE: 2 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)', declared: 'decimal(10,2)' });
    expect(sqlserverColumnType({ DATA_TYPE: 'money' })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(19,4)', declared: 'money' });
    expect(sqlserverColumnType({ DATA_TYPE: 'nvarchar', CHARACTER_MAXIMUM_LENGTH: 100 })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'nvarchar(100)' });
    expect(sqlserverColumnType({ DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: -1 }).declared).toBe('varchar(max)');
    expect(sqlserverColumnType({ DATA_TYPE: 'datetime2', DATETIME_PRECISION: 7 })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP', declared: 'datetime2(7)' });
    expect(sqlserverColumnType({ DATA_TYPE: 'datetime' }).declared).toBe('datetime');
    expect(sqlserverColumnType({ DATA_TYPE: 'bit' }).sqlType).toBe('BOOLEAN');
    expect(sqlserverColumnType({ DATA_TYPE: 'varbinary', CHARACTER_MAXIMUM_LENGTH: 16 })).toEqual({ type: 'BLOB', sqlType: 'BLOB', declared: 'varbinary(16)' });
    expect(sqlserverColumnType({ DATA_TYPE: 'uniqueidentifier' }).sqlType).toBe('UUID');
    expect(sqlserverColumnType({ DATA_TYPE: 'geography' }).sqlType).toBe('BLOB');
    expect(sqlserverColumnType({ DATA_TYPE: 'xml' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'xml' });
  });

  it('converts the plain values the client gives', () => {
    expect(convertSqlserverValue(null, 'VARCHAR')).toBeNull();
    expect(convertSqlserverValue(101, 'BIGINT')).toBe(101);
    expect(convertSqlserverValue('99999999999999999999', 'BIGINT')).toBeNull();
    expect(convertSqlserverValue('19.9900', 'VARCHAR')).toBe('19.9900');
    expect(convertSqlserverValue('2024-01-15', 'DATE')).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(convertSqlserverValue('2024-04-01 09:30:00.000', 'TIMESTAMP')).toBe(Date.UTC(2024, 3, 1, 9, 30));
    expect(convertSqlserverValue(true, 'BOOLEAN')).toBe(true);
    expect(convertSqlserverValue(0, 'BOOLEAN')).toBe(false);
    expect(convertSqlserverValue(new Uint8Array([1, 2]), 'BLOB')).toEqual(new Uint8Array([1, 2]));
    expect(convertSqlserverValue(1.5, 'DOUBLE')).toBe(1.5);
  });

  it('writes a UTC Date back as the wall-clock text it was read from', () => {
    const d = new Date(Date.UTC(2024, 3, 1, 9, 30, 5, 7));
    expect(utcText(d, 'date')).toBe('2024-04-01');
    expect(utcText(d, 'time')).toBe('09:30:05.007');
    expect(utcText(d, 'timestamp')).toBe('2024-04-01 09:30:05.007');
  });
});
