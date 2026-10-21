import { describe, expect, it } from 'vitest';
import { convertSnowflakeValue, epochMs, numberType, snowflakeColumnType, snowflakeFieldType, snowflakeNamedType, timeText, timestampTzText } from './snowflakeTypes';

describe('Snowflake types', () => {
  it('holds a NUMBER by its precision and scale', () => {
    expect(numberType(10, 0)).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(numberType(18, 0)).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(numberType(38, 0)).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(38,0)' });
    expect(numberType(10, 2)).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(numberType(null, null)).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(38,0)' });
  });

  it('maps the result metadata’s and INFORMATION_SCHEMA’s type names', () => {
    expect(snowflakeFieldType({ name: 'a', type: 'fixed', precision: 10, scale: 0 })).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(snowflakeFieldType({ name: 'a', type: 'fixed', precision: 10, scale: 2 })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(snowflakeFieldType({ name: 'a', type: 'real' })).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(snowflakeFieldType({ name: 'a', type: 'text' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(snowflakeFieldType({ name: 'a', type: 'boolean' })).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(snowflakeFieldType({ name: 'a', type: 'date' })).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(snowflakeFieldType({ name: 'a', type: 'time' })).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(snowflakeFieldType({ name: 'a', type: 'timestamp_ntz' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(snowflakeFieldType({ name: 'a', type: 'timestamp_ltz' })).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(snowflakeFieldType({ name: 'a', type: 'timestamp_tz' })).toEqual({ type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' });
    expect(snowflakeFieldType({ name: 'a', type: 'binary' })).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(snowflakeFieldType({ name: 'a', type: 'variant' })).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(snowflakeFieldType({ name: 'a', type: 'object' })).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(snowflakeFieldType({ name: 'a', type: 'array' })).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(snowflakeFieldType({ name: 'a', type: 'geography' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(snowflakeNamedType('FLOAT')).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(snowflakeNamedType('TIMESTAMP_NTZ(9)')).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
  });

  it('declares a catalogued column as Snowflake does', () => {
    expect(snowflakeColumnType({ DATA_TYPE: 'NUMBER', NUMERIC_PRECISION: '10', NUMERIC_SCALE: '2' })).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)', declared: 'NUMBER(10,2)' });
    expect(snowflakeColumnType({ DATA_TYPE: 'TEXT', CHARACTER_MAXIMUM_LENGTH: '100' })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'VARCHAR(100)' });
    expect(snowflakeColumnType({ DATA_TYPE: 'TEXT' }).declared).toBe('VARCHAR');
    expect(snowflakeColumnType({ DATA_TYPE: 'TIMESTAMP_NTZ' }).declared).toBe('TIMESTAMP_NTZ');
    expect(snowflakeColumnType({ DATA_TYPE: 'ARRAY' }).sqlType).toBe('JSON');
  });

  it('converts the SQL API’s text encodings', () => {
    expect(convertSnowflakeValue('42', { name: 'a', type: 'fixed', precision: 10, scale: 0 })).toBe(42);
    expect(convertSnowflakeValue('19.99', { name: 'a', type: 'fixed', precision: 10, scale: 2 })).toBe('19.99');
    expect(convertSnowflakeValue('1.5', { name: 'a', type: 'real' })).toBe(1.5);
    expect(convertSnowflakeValue('true', { name: 'a', type: 'boolean' })).toBe(true);
    expect(convertSnowflakeValue('0', { name: 'a', type: 'boolean' })).toBe(false);
    expect(convertSnowflakeValue('19737', { name: 'a', type: 'date' })).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(convertSnowflakeValue('37800.5', { name: 'a', type: 'time' })).toBe('10:30:00.500');
    expect(convertSnowflakeValue('1711963800.123456789', { name: 'a', type: 'timestamp_ntz' })).toBe(Date.UTC(2024, 3, 1, 9, 30, 0, 123));
    expect(convertSnowflakeValue('1711963800.000000000 1500', { name: 'a', type: 'timestamp_tz' })).toBe('2024-04-01 10:30:00+01:00');
    expect(convertSnowflakeValue('1711963800.500000000 1140', { name: 'a', type: 'timestamp_tz' })).toBe('2024-04-01 04:30:00.500-05:00');
    expect(convertSnowflakeValue('6869', { name: 'a', type: 'binary' })).toEqual(new Uint8Array([104, 105]));
    expect(convertSnowflakeValue('[\n  "a"\n]', { name: 'a', type: 'array' })).toBe('[\n  "a"\n]');
    expect(convertSnowflakeValue(null, { name: 'a', type: 'text' })).toBeNull();
    expect(timeText(0)).toBe('00:00:00');
    expect(epochMs('-1.5')).toBe(-1500);
    expect(timestampTzText('x')).toBeNull();
  });
});
