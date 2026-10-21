import { describe, expect, it } from 'vitest';
import { convertCqlValue, cqlDeclaredType, cqlFieldType, cqlNamedType, plainCql } from './cassandraTypes';

describe('CQL types in DuckDB', () => {
  it('maps the built-in types, the exact ones crossing as text', () => {
    expect(cqlNamedType('text')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(cqlNamedType('BIGINT')).toEqual({ type: 'BIGINT', sqlType: 'BIGINT' });
    expect(cqlNamedType('int')).toEqual({ type: 'BIGINT', sqlType: 'INTEGER' });
    expect(cqlNamedType('tinyint')).toEqual({ type: 'BIGINT', sqlType: 'TINYINT' });
    expect(cqlNamedType('varint')).toEqual({ type: 'VARCHAR', sqlType: 'HUGEINT' });
    expect(cqlNamedType('decimal')).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(38,9)' });
    expect(cqlNamedType('float')).toEqual({ type: 'DOUBLE', sqlType: 'FLOAT' });
    expect(cqlNamedType('timestamp')).toEqual({ type: 'TIMESTAMP', sqlType: 'TIMESTAMP' });
    expect(cqlNamedType('date')).toEqual({ type: 'DATE', sqlType: 'DATE' });
    expect(cqlNamedType('time')).toEqual({ type: 'VARCHAR', sqlType: 'TIME' });
    expect(cqlNamedType('timeuuid')).toEqual({ type: 'VARCHAR', sqlType: 'UUID' });
    expect(cqlNamedType('blob')).toEqual({ type: 'BLOB', sqlType: 'BLOB' });
    expect(cqlNamedType('inet')).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR' });
    expect(cqlNamedType('list')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
    expect(cqlNamedType('address')).toEqual({ type: 'VARCHAR', sqlType: 'JSON' });
  });

  it('reads a declared type through frozen<> and type arguments', () => {
    expect(cqlDeclaredType('frozen<map<text, int>>')).toEqual({ type: 'VARCHAR', sqlType: 'JSON', declared: 'frozen<map<text, int>>' });
    expect(cqlDeclaredType('set<text>').sqlType).toBe('JSON');
    expect(cqlDeclaredType('frozen<address>').sqlType).toBe('JSON');
    expect(cqlDeclaredType(' decimal ')).toEqual({ type: 'VARCHAR', sqlType: 'DECIMAL(38,9)', declared: 'decimal' });
    expect(cqlDeclaredType('vector<float, 3>').sqlType).toBe('JSON');
  });

  it('types a result column by its protocol code, custom as text', () => {
    expect(cqlFieldType({ type: { code: 9 } })).toEqual({ type: 'BIGINT', sqlType: 'INTEGER', declared: 'int' });
    expect(cqlFieldType({ type: { code: 33 } })).toEqual({ type: 'VARCHAR', sqlType: 'JSON', declared: 'map' });
    expect(cqlFieldType({ type: { code: 0 } })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'custom' });
    expect(cqlFieldType({ type: { code: 99 } })).toEqual({ type: 'VARCHAR', sqlType: 'VARCHAR', declared: 'custom' });
  });

  it('makes the driver’s own values plain: numbers as text where exact, tuples and vectors as lists, maps as objects', () => {
    class Long {
      toString() {
        return '9007199254740993';
      }
    }
    class LocalDate {
      toString() {
        return '2024-01-15';
      }
    }
    class Tuple {
      values() {
        return [1, 'a'];
      }
    }
    class Vector {
      *[Symbol.iterator]() {
        yield 0.5;
        yield 1.5;
      }
    }
    expect(plainCql(new Long())).toBe('9007199254740993');
    expect(plainCql(new LocalDate())).toBe('2024-01-15');
    expect(plainCql(new Tuple())).toEqual([1, 'a']);
    expect(plainCql(new Vector())).toEqual([0.5, 1.5]);
    expect(plainCql(new Map([['city', 'London']]))).toEqual({ city: 'London' });
    expect(plainCql(new Set(['a']))).toEqual(['a']);
    expect(plainCql({ street: 'x', n: new Long() })).toEqual({ street: 'x', n: '9007199254740993' });
    expect(plainCql(Buffer.from([1, 2]))).toEqual(new Uint8Array([1, 2]));
    const d = new Date('2024-04-01T09:30:00Z');
    expect(plainCql(d)).toBe(d);
    expect(plainCql(undefined)).toBeNull();
  });

  it('converts plain values to their Arrow type: dates as days, timestamps as milliseconds, the rest as text or JSON', () => {
    expect(convertCqlValue('2024-01-15', 'DATE')).toBe(19737);
    expect(convertCqlValue(new Date('2024-04-01T09:30:00Z'), 'TIMESTAMP')).toBe(1711963800000);
    expect(convertCqlValue('42', 'BIGINT')).toBe(42);
    expect(convertCqlValue('x', 'BIGINT')).toBeNull();
    expect(convertCqlValue('19.99', 'VARCHAR')).toBe('19.99');
    expect(convertCqlValue({ city: 'London' }, 'VARCHAR')).toBe('{"city":"London"}');
    expect(convertCqlValue(new Uint8Array([255]), 'VARCHAR')).toBe('0xff');
    expect(convertCqlValue(true, 'BOOLEAN')).toBe(true);
    expect(convertCqlValue(null, 'DOUBLE')).toBeNull();
  });
});
