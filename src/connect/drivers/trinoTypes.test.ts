import { describe, expect, it } from 'vitest';
import { convertTrinoValue, trinoType } from './trinoTypes';

describe('Trino types', () => {
  it('maps types to the loader’s types', () => {
    expect(trinoType('tinyint')).toEqual({ type: 'BIGINT', sqlType: 'SMALLINT' });
    expect(trinoType('integer')).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(trinoType('bigint')).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(trinoType('real')).toEqual({ type: 'DOUBLE', sqlType: 'FLOAT' });
    expect(trinoType('double')).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(trinoType('decimal(10,2)')).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(trinoType('decimal(38, 2)')).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(38,2)' });
    expect(trinoType('boolean')).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(trinoType('date')).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(trinoType('timestamp(3)')).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(trinoType('timestamp(3) with time zone')).toEqual({ type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' });
    expect(trinoType('time(3)')).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(trinoType('time(3) with time zone')).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(trinoType('interval day to second')).toEqual({ type: 'VARCHAR', sqlType: 'INTERVAL' });
    expect(trinoType('uuid')).toEqual({ type: 'VARCHAR', sqlType: 'UUID' });
    expect(trinoType('varbinary')).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(trinoType('varchar(100)')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(trinoType('char(3)')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(trinoType('array(varchar)')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(trinoType('map(varchar, integer)')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(trinoType('row(a integer, b varchar)')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(trinoType('json')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(trinoType('ipaddress')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
  });

  it('converts the protocol’s values', () => {
    expect(convertTrinoValue(null, 'VARCHAR')).toBeNull();
    expect(convertTrinoValue(101, 'BIGINT')).toBe(101);
    expect(convertTrinoValue('19.99', 'VARCHAR')).toBe('19.99');
    expect(convertTrinoValue('Infinity', 'DOUBLE')).toBe(Infinity);
    expect(convertTrinoValue('NaN', 'DOUBLE')).toBeNull();
    expect(convertTrinoValue('2024-01-15', 'DATE')).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(convertTrinoValue('2024-04-01 09:30:00.000', 'TIMESTAMP')).toBe(Date.UTC(2024, 3, 1, 9, 30));
    expect(convertTrinoValue(true, 'BOOLEAN')).toBe(true);
    expect(convertTrinoValue('AQI=', 'BLOB')).toEqual(new Uint8Array([1, 2]));
    expect(convertTrinoValue(['a', 'b'], 'VARCHAR')).toBe('["a","b"]');
    expect(convertTrinoValue({ k: 1 }, 'VARCHAR')).toBe('{"k":1}');
  });
});
