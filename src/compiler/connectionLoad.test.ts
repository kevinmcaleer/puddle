import { compileConnectionLoad, loadType } from './connectionLoad';

describe('connection load', () => {
  it('casts each column to its declared type, text for anything unknown', () => {
    expect(loadType('BIGINT')).toBe('BIGINT');
    expect(loadType('decimal(10,2)')).toBe('DECIMAL(10,2)');
    expect(loadType('TIMESTAMP WITH TIME ZONE')).toBe('TIMESTAMP WITH TIME ZONE');
    expect(loadType('GEOMETRY')).toBe('VARCHAR');
    expect(loadType("VARCHAR'); DROP TABLE x; --")).toBe('VARCHAR');
    expect(compileConnectionLoad('src_1', [{ name: 'id', sqlType: 'BIGINT' }, { name: 'a "b"', sqlType: 'weird' }], { staging: 'src_1_arrow' })).toBe(
      'CREATE OR REPLACE TABLE "src_1" AS SELECT CAST("id" AS BIGINT) AS "id", CAST("a ""b""" AS VARCHAR) AS "a ""b""" FROM "src_1_arrow"',
    );
    expect(compileConnectionLoad('src_1', [], { relation: '(SELECT * FROM "conn_c1"."main"."orders" LIMIT 5)' })).toBe('CREATE OR REPLACE TABLE "src_1" AS SELECT * FROM (SELECT * FROM "conn_c1"."main"."orders" LIMIT 5)');
  });
});
