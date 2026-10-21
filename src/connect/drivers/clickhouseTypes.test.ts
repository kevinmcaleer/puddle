import { describe, expect, it } from 'vitest';
import { clickhouseType, convertClickhouseValue, unwrap } from './clickhouseTypes';

describe('ClickHouse types', () => {
  it('takes the wrappers off', () => {
    expect(unwrap('Nullable(String)')).toBe('String');
    expect(unwrap('LowCardinality(Nullable(String))')).toBe('String');
    expect(unwrap('Array(Nullable(UInt8))')).toBe('Array(Nullable(UInt8))');
  });

  it('maps types to the loader’s types, wide integers and decimals exact as text', () => {
    expect(clickhouseType('UInt8')).toEqual({ type: 'BIGINT', sqlType: 'SMALLINT' });
    expect(clickhouseType('Int32')).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(clickhouseType('UInt32')).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(clickhouseType('Int64')).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(clickhouseType('UInt64')).toEqual({ type: 'VARCHAR', sqlType: 'UBIGINT' });
    expect(clickhouseType('Int128')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(clickhouseType('Float32')).toEqual({ type: 'DOUBLE', sqlType: 'FLOAT' });
    expect(clickhouseType('Float64')).toEqual({ type: 'DOUBLE', sqlType: 'DOUBLE' });
    expect(clickhouseType('Decimal(10, 2)')).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(10,2)' });
    expect(clickhouseType('Nullable(Decimal64(4))')).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(18,4)' });
    expect(clickhouseType('Decimal256(10)')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(clickhouseType('Bool')).toEqual({ type: 'BOOLEAN', sqlType: 'BOOLEAN' });
    expect(clickhouseType('Date32')).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(clickhouseType("DateTime64(3, 'UTC')")).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(clickhouseType('UUID')).toEqual({ type: 'VARCHAR', sqlType: 'UUID' });
    expect(clickhouseType('Array(String)')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(clickhouseType('Map(String, UInt64)')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(clickhouseType('Tuple(a UInt8, b String)')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(clickhouseType("Enum8('a' = 1, 'b' = 2)")).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(clickhouseType('LowCardinality(String)')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(clickhouseType('IPv4')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
  });

  it('converts JSONCompact’s values', () => {
    expect(convertClickhouseValue(null, 'VARCHAR')).toBeNull();
    expect(convertClickhouseValue(101, 'BIGINT')).toBe(101);
    expect(convertClickhouseValue('9007199254740993', 'BIGINT')).toBeNull();
    expect(convertClickhouseValue('18446744073709551615', 'VARCHAR')).toBe('18446744073709551615');
    expect(convertClickhouseValue('inf', 'DOUBLE')).toBe(Infinity);
    expect(convertClickhouseValue('nan', 'DOUBLE')).toBeNull();
    expect(convertClickhouseValue('2024-01-15', 'DATE')).toBe(Math.round(Date.UTC(2024, 0, 15) / 86_400_000));
    expect(convertClickhouseValue('2024-04-01 09:30:00.123', 'TIMESTAMP')).toBe(Date.UTC(2024, 3, 1, 9, 30, 0, 123));
    expect(convertClickhouseValue(true, 'BOOLEAN')).toBe(true);
    expect(convertClickhouseValue(['a', 'b'], 'VARCHAR')).toBe('["a","b"]');
    expect(convertClickhouseValue({ k: 1 }, 'VARCHAR')).toBe('{"k":1}');
  });
});
