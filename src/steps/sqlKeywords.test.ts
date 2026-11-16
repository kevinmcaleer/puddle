import { describe, expect, it } from 'vitest';
import { keywordCase, upperKeywords } from './sqlKeywords';

describe('upperKeywords', () => {
  it('writes SQL’s own words in capitals and leaves names, functions, strings and comments as typed', () => {
    expect(upperKeywords('select region, sum(total) as total from orders where status = \'from\' group by region order by 2 desc nulls last')).toBe(
      'SELECT region, sum(total) AS total FROM orders WHERE status = \'from\' GROUP BY region ORDER BY 2 DESC NULLS LAST',
    );
    expect(upperKeywords('create or replace table t as select * from "select" -- where from\n')).toBe('CREATE OR REPLACE TABLE t AS SELECT * FROM "select" -- where from\n');
  });

  it('leaves a keyword that is a function, a column or an alias here', () => {
    expect(upperKeywords('select left(name, 2), replace(name, \'a\', \'b\'), if(a, 1, 2), first(x), last(x) from t')).toBe("SELECT left(name, 2), replace(name, 'a', 'b'), if(a, 1, 2), first(x), last(x) FROM t");
    expect(upperKeywords('select t.end, o.order from t left join o on true')).toBe('SELECT t.end, o.order FROM t LEFT JOIN o ON TRUE');
    expect(upperKeywords('select total as all from t')).toBe('SELECT total AS all FROM t');
    // Words as likely to be columns stay as typed.
    expect(upperKeywords('select name, date, year, value, type, key from t')).toBe('SELECT name, date, year, value, type, key FROM t');
  });

  it('still takes the query after AS', () => {
    expect(upperKeywords('create table t as select 1')).toBe('CREATE TABLE t AS SELECT 1');
    expect(upperKeywords('with a as (select 1) select * from a')).toBe('WITH a AS (SELECT 1) SELECT * FROM a');
  });

  it('leaves SQL it can’t read alone until it reads again', () => {
    expect(upperKeywords("select 'open from t")).toBe("select 'open from t");
  });
});

describe('keywordCase', () => {
  it('waits for the word the caret is in or at the end of: or may yet be orders', () => {
    expect(keywordCase('select * from t where a or', 26)).toEqual([
      { from: 0, to: 6, insert: 'SELECT' },
      { from: 9, to: 13, insert: 'FROM' },
      { from: 16, to: 21, insert: 'WHERE' },
    ]);
    // Once the caret has moved on (a space typed), it is taken.
    expect(keywordCase('SELECT * FROM t WHERE a or ', 27)).toEqual([{ from: 24, to: 26, insert: 'OR' }]);
    expect(keywordCase('SELECT * FROM orders', 20)).toEqual([]);
  });
});
