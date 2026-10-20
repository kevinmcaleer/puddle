import { findShapeIssues, parseShape } from './shape';

const facts = (over: Partial<ReturnType<typeof parseShape>> = {}) => ({ rows: 10, blank: 0, narrow: 0, separator: 0, header: 0, total: 0, totalEx: [], top: 0, bottom: 0, ...over });
const columns = ['id', 'name', 'amount'];

describe('parseShape', () => {
  it('reads compileShape’s row, lists and missing values included', () => {
    expect(parseShape({ rows: 10n, blank: 1, narrow: '2', separator: 1, separatorEx: '-----', header: 1, total: 1, totalEx: ['total', null], totalCol: 'id', top: 0, bottom: 2 })).toEqual({
      rows: 10, blank: 1, narrow: 2, separator: 1, separatorEx: '-----', header: 1, total: 1, totalEx: ['total'], totalCol: 'id', top: 0, bottom: 2,
    });
    expect(parseShape({})).toEqual({ rows: 0, blank: 0, narrow: 0, separator: 0, separatorEx: undefined, header: 0, total: 0, totalEx: [], totalCol: undefined, top: 0, bottom: 0 });
  });
});

describe('findShapeIssues', () => {
  it('finds nothing in a plain table, and nothing when every row is a banner', () => {
    expect(findShapeIssues(columns, facts(), {})).toEqual([]);
    expect(findShapeIssues(columns, facts({ rows: 3, narrow: 3, top: 3 }), { header: false })).toEqual([]);
    expect(findShapeIssues([], facts({ header: 1 }), {})).toEqual([]);
  });

  it('a footer becomes a bottom skip added to the one in place; a banner only when no header row was taken from the file', () => {
    const [footer] = findShapeIssues(columns, facts({ narrow: 2, bottom: 2 }), { skipBottom: 1 });
    expect(footer).toMatchObject({ kind: 'footerRows', count: 2, share: 0.2, severity: 'fix', fix: { readOptions: { skipBottom: 3 }, label: 'Skip 3 rows at the bottom' } });
    // Named columns: the leading narrow rows are inside the table (the skip would take the header with them).
    expect(findShapeIssues(columns, facts({ narrow: 2, top: 2 }), {}).map((i) => i.kind)).toEqual(['narrowRows']);
    const [banner] = findShapeIssues(['column0', 'column1'], facts({ narrow: 2, top: 2 }), { skip: 1 });
    expect(banner).toMatchObject({ kind: 'bannerRows', count: 2, fix: { readOptions: { skip: 3 }, label: 'Skip 3 lines at the top' } });
    expect(findShapeIssues(columns, facts({ narrow: 1, top: 1 }), { header: false }).map((i) => i.kind)).toEqual(['bannerRows']);
  });

  it('a repeated header is removed where the first two named columns equal their names, matching case', () => {
    const [issue] = findShapeIssues(['column0', 'id', 'name', 'amount'], facts({ header: 1 }), {});
    expect(issue).toMatchObject({ kind: 'repeatedHeader', count: 1, examples: ['id', 'name'] });
    expect(issue!.fix).toEqual({ type: 'filterRows', params: { mode: 'remove', match: 'all', matchCase: true, conditions: [{ column: 'id', op: 'equals', value: 'id' }, { column: 'name', op: 'equals', value: 'name' }] } });
  });

  it('separators and narrow rows inside the table go together, blank rows apart, each with a remove step', () => {
    const issues = findShapeIssues(columns, facts({ separator: 2, separatorEx: '==============', narrow: 3, bottom: 1, blank: 2 }), {});
    expect(issues.map((i) => [i.kind, i.count])).toEqual([['footerRows', 1], ['narrowRows', 4], ['blankRows', 2]]);
    const narrow = issues[1]!;
    expect(narrow.examples).toEqual(['============']);
    expect(narrow.fix).toEqual({ type: 'filterRows', params: { mode: 'remove', match: 'all', matchCase: false, conditions: [{ column: 'name', op: 'empty', value: '' }, { column: 'amount', op: 'empty', value: '' }] } });
    expect(issues[2]!.fix).toEqual({ type: 'removeBlankRows', params: { columns: [] } });
    // One column: nothing past it can be empty, so narrow rows have no fix.
    expect(findShapeIssues(['x'], facts({ narrow: 1 }), {})[0]).toMatchObject({ kind: 'narrowRows', fix: undefined });
  });

  it('total rows are a suggestion, removed by the words seen at the start of the column they were in', () => {
    const [issue] = findShapeIssues(columns, facts({ total: 2, totalEx: ['total', 'grand total'], totalCol: 'name' }), {});
    expect(issue).toMatchObject({ kind: 'totalRows', count: 2, severity: 'suggest', examples: ['total', 'grand total'] });
    expect(issue!.fix).toEqual({ type: 'filterRows', params: { mode: 'remove', match: 'any', matchCase: false, conditions: [{ column: 'name', op: 'startsWith', value: 'total' }, { column: 'name', op: 'startsWith', value: 'grand total' }] } });
    expect(findShapeIssues(columns, facts({ total: 1, totalEx: [], totalCol: 'id' }), {})[0]!.fix).toMatchObject({ params: { conditions: [{ column: 'id', op: 'startsWith', value: 'total' }] } });
  });

  it('leaves out ignored issues', () => {
    expect(findShapeIssues(columns, facts({ header: 1, blank: 1 }), {}, ['repeatedHeader']).map((i) => i.kind)).toEqual(['blankRows']);
  });
});
