import { describe, expect, it } from 'vitest';
import { compileAnalysis } from './analysis';
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
    expect(sql).toContain(`list_slice(list_sort(list(DISTINCT trim(CAST("region" AS VARCHAR))) FILTER (WHERE "region" IS NOT NULL)), 1, 60) AS "vals1"`);
    expect(sql).not.toContain('vals0');
    expect(sql).toMatch(/FROM \(WITH "n_in" AS \(SELECT \* FROM read_csv\('src_a\.csv', null_padding = true\)\)/);
  });

  it('leaves the duplicate count out when no columns are named', () => {
    expect(compileAnalysis(project, { nodeId: 'in' }, [])).toBe(`SELECT count(*) AS "rows" FROM (${compileAnalysis(project, { nodeId: 'in' }, []).split('FROM (')[1]}`);
  });
});
