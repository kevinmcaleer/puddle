import { describe, expect, it } from 'vitest';
import { compileAnalysis, compileDistinctFacts, compileShape, compileSkew, compileValueCounts } from './analysis';
import { flow, src } from '../../tests/helpers/projects';

const project = flow({ sources: [src({ id: 'a', format: 'csv' })], nodes: [{ id: 'in', type: 'source', sourceId: 'a' }] });

describe('compileAnalysis', () => {
  it('counts rows and whole-row duplicates, and per text column the ways it is untidy with examples', () => {
    const sql = compileAnalysis(project, { nodeId: 'in' }, [{ column: 'name', text: true }, { column: 'region', text: true, values: true }], ['name', 'region']);
    expect(sql).toContain('count(*) AS "rows", count(*) - count(DISTINCT ("name", "region")) AS dups');
    expect(sql).toContain(`count(*) FILTER (WHERE CAST("name" AS VARCHAR) <> trim(CAST("name" AS VARCHAR))) AS "edges0"`);
    expect(sql).toContain(`[min(CAST("name" AS VARCHAR)) FILTER (WHERE trim(CAST("name" AS VARCHAR)) LIKE '%  %'), max(CAST("name" AS VARCHAR)) FILTER (WHERE trim(CAST("name" AS VARCHAR)) LIKE '%  %')] AS "dblEx0"`);
    expect(sql).toContain(`regexp_matches(CAST("name" AS VARCHAR), '[\\x00-\\x1F\\x7F\\x{00A0}\\x{200B}-\\x{200D}\\x{2060}\\x{FEFF}]')`);
    expect(sql).toContain(`count(*) FILTER (WHERE "name" IS NOT NULL AND trim(CAST("name" AS VARCHAR)) = '') AS "blank0"`);
    expect(sql).toContain(`count(*) FILTER (WHERE "name" IS NOT NULL AND trim(CAST("name" AS VARCHAR)) <> '' AND lower(trim(CAST("name" AS VARCHAR))) IN ('n/a', 'na',`);
    expect(sql).toContain(`AS "ph0"`);
    expect(sql).toContain(`regexp_matches(trim(CAST("region" AS VARCHAR)), '^[A-Za-z][^:=]{0,39}[:=]\\s*\\S')`);
    expect(sql).toContain(`AS "mojiEx1"`);
    expect(sql).toContain(`AS "comma1"`);
    // Nothing distinct: that is compileDistinctFacts's job, so the browser's memory holds.
    expect(sql).not.toContain('DISTINCT trim');
    expect(sql).not.toContain('list(');
    expect(sql).toMatch(/FROM \(WITH "n_in" AS \(SELECT \* FROM read_csv\('src_a\.csv', null_padding = true\)\)/);
  });

  it('adds the range and whole count for numbers and the row-number matches for an index column', () => {
    const sql = compileAnalysis(project, { nodeId: 'in' }, [{ column: 'idx', index: true, numeric: true }, { column: 'id', id: true }]);
    expect(sql).toContain(`min(TRY_CAST(trim(CAST("idx" AS VARCHAR)) AS DOUBLE)) AS "nmin0"`);
    expect(sql).toContain(`count(*) FILTER (WHERE TRY_CAST(trim(CAST("idx" AS VARCHAR)) AS BIGINT) = "__puddle_rn") AS "seq10", count(*) FILTER (WHERE TRY_CAST(trim(CAST("idx" AS VARCHAR)) AS BIGINT) = "__puddle_rn" - 1) AS "seq00"`);
    expect(sql).toContain(`FROM (SELECT *, row_number() OVER () AS "__puddle_rn" FROM (WITH`);
    // Without an index check, no row numbers are added.
    expect(compileAnalysis(project, { nodeId: 'in' }, [{ column: 'id', id: true }])).not.toContain('row_number');
  });

  it('reads what the distinct values say in one grouped query per column: the count, the mode, and for text the placeholders, odd values and shapes', () => {
    const sql = compileDistinctFacts(project, { nodeId: 'in' }, [{ column: 'id', id: true }, { column: 'region', text: true }]);
    expect(sql).toMatch(/^WITH src AS \(WITH "n_in" AS/);
    expect(sql).toContain(`SELECT 'id' AS c, count(*) AS dist, arg_max(t, n) AS mode, NULL AS "phEx", NULL AS "nonNumEx", NULL AS "nonDateEx", NULL AS shapes, NULL AS "shapesEx" FROM (SELECT trim(CAST("id" AS VARCHAR)) AS t, count(*) AS n FROM src WHERE "id" IS NOT NULL GROUP BY 1) UNION ALL SELECT 'region' AS c`);
    expect(sql).toContain(`list_slice(list_sort(list(t) FILTER (WHERE t <> '' AND lower(t) IN ('n/a', 'na',`);
    expect(sql).toContain(`count(DISTINCT regexp_replace(regexp_replace(regexp_replace(t, '[0-9]', '9', 'g'), '[A-Z]', 'A', 'g'), '[a-z]', 'a', 'g')) FILTER (WHERE t <> '' AND NOT lower(t) IN (`);
    expect(sql).toContain(`AND lower(t) <> 'region') AS shapes`);
    expect(() => compileDistinctFacts(project, { nodeId: 'in' }, [])).toThrow(RangeError);
  });

  it('counts the values of columns with few of them in one query, the most frequent first and at most 60 per column', () => {
    const sql = compileValueCounts(project, { nodeId: 'in' }, ['region', 'status']);
    expect(sql).toMatch(/^WITH src AS \(WITH "n_in" AS/);
    expect(sql).toContain(`SELECT 'region' AS c, trim(CAST("region" AS VARCHAR)) AS v, count(*) AS n FROM src WHERE "region" IS NOT NULL AND trim(CAST("region" AS VARCHAR)) <> '' GROUP BY 2 UNION ALL SELECT 'status' AS c`);
    expect(sql).toContain(`QUALIFY row_number() OVER (PARTITION BY c ORDER BY n DESC, v) <= 60 ORDER BY c, n DESC, v`);
    expect(() => compileValueCounts(project, { nodeId: 'in' }, [])).toThrow(RangeError);
  });

  it('leaves the duplicate count out when no columns are named', () => {
    expect(compileAnalysis(project, { nodeId: 'in' }, [])).toBe(`SELECT count(*) AS "rows" FROM (${compileAnalysis(project, { nodeId: 'in' }, []).split('FROM (')[1]}`);
  });
});

describe('a row limit', () => {
  it('looks at the first rows only, in every analysis query, when one is given', () => {
    const checks = [{ column: 'name', text: true }];
    for (const sql of [compileAnalysis(project, { nodeId: 'in' }, checks, ['name'], 500), compileDistinctFacts(project, { nodeId: 'in' }, checks, 500), compileValueCounts(project, { nodeId: 'in' }, ['name'], 500), compileShape(project, { nodeId: 'in' }, ['name'], 500)]) {
      expect(sql).toMatch(/\) LIMIT 500\)/);
    }
    expect(compileAnalysis(project, { nodeId: 'in' }, checks, ['name'])).not.toContain('LIMIT');
  });
});

describe('compileSkew', () => {
  it('groups the rows by the kind of value in each column, with the first and last row of each group', () => {
    const sql = compileSkew(project, { nodeId: 'in' }, [{ name: 'id', type: 'BIGINT' }, { name: 'when', type: 'DATE' }, { name: 'ok', type: 'BOOLEAN' }, { name: 'note', type: 'VARCHAR' }, { name: 'blob', type: 'BLOB' }], 500);
    expect(sql).toMatch(/^SELECT sig, count\(\*\) AS n, min\(rn\) AS first, max\(rn\) AS last FROM \(SELECT row_number\(\) OVER \(\) AS rn, concat\(/);
    expect(sql).toContain(`CASE WHEN "id" IS NULL THEN 'e' ELSE 'n' END`);
    expect(sql).toContain(`CASE WHEN "when" IS NULL THEN 'e' ELSE 'd' END`);
    expect(sql).toContain(`CASE WHEN "ok" IS NULL THEN 'e' ELSE 'b' END`);
    expect(sql).toContain(`CASE WHEN nullif(trim(CAST("note" AS VARCHAR)), '') IS NULL THEN 'e' WHEN`);
    expect(sql).toContain(`THEN 'd' ELSE 't' END`);
    expect(sql).toContain(`CASE WHEN "blob" IS NULL THEN 'e' ELSE 'x' END`);
    expect(sql).toMatch(/\) LIMIT 500\)\) GROUP BY sig ORDER BY n DESC, first LIMIT 40$/);
    expect(() => compileSkew(project, { nodeId: 'in' }, [{ name: 'id', type: 'BIGINT' }])).toThrow(/Too few columns/);
  });
});
