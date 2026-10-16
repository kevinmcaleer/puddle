import { flow, src, step } from '../../tests/helpers/projects';
import type { ParseOptions, Source } from '../model';
import { rulePredicate } from './rules';
import { compile, compileCount, compileDateDetection, compileRules, compileDisplayPage, compilePreview, compileProfile, compileTypeSniff, upstreamKey } from './compile';
import { CompileError, UnwiredError } from './errors';
import { SchemaCache } from './schemaCache';
import { ident, setExtensionRepository, str } from './sql';
import { dropTable, sourceRelation, sourceTableName } from './sources';
import { expressionProblem, regexProblem } from './steps';

const cleanFlow = (steps = [step('s1', 'trimWhitespace', { columns: ['name'] }), step('s2', 'changeCase', { columns: ['name'], mode: 'title' })]) =>
  flow({
    sources: [src({ id: 'cust', format: 'csv' })],
    nodes: [
      { id: 'src', type: 'source', sourceId: 'cust' },
      { id: 'clean', type: 'transform', steps },
      { id: 'out', type: 'output' },
    ],
    wires: [['src', 'clean'], ['clean', 'out']],
  });

describe('quoting', () => {
  it('escapes identifiers and strings', () => {
    expect(ident('a"b')).toBe('"a""b"');
    expect(str("O'Brien")).toBe("'O''Brien'");
  });
});

describe('sources', () => {
  it.each<[Source['format'], ParseOptions]>([
    ['csv', {}],
    ['csv', { delimiter: ';', header: true, quote: '"', encoding: 'latin-1', nullStrings: ['N/A', ''] }],
    ['tsv', {}],
    ['json', {}],
    ['ndjson', {}],
    ['parquet', {}],
    ['xlsx', {}],
  ])('%s with %j', (format, parseOptions) => {
    expect(sourceRelation(src({ id: 'x', format, parseOptions }))).toMatchSnapshot();
  });

  it('reads an Excel sheet from a table named for its file and read options', () => {
    const file = { originalName: 'b.xlsx', size: 1, lastModified: 0, headHash: 'h1' };
    const name = (parseOptions: ParseOptions, headHash = 'h1') => sourceTableName(src({ id: 'x', format: 'xlsx', parseOptions, file: { ...file, headHash } }));
    expect(name({})).toMatch(/^src_x_[0-9a-f]{12}$/);
    expect(sourceRelation(src({ id: 'x', format: 'xlsx', parseOptions: {}, file }))).toBe(ident(name({})));
    expect(name({})).toBe(name({}));
    const names = [name({}), name({ sheet: 'Visits' }), name({ headerRow: 3 }), name({ headerRow: 0 }), name({ range: 'A1:B2' }), name({}, 'h2')];
    expect(new Set(names).size).toBe(names.length);
    // Options Excel doesn't use don't change it.
    expect(name({ delimiter: ';' })).toBe(name({}));
    expect(dropTable(name({}))).toBe(`DROP TABLE IF EXISTS ${ident(name({}))}`);
  });
});

describe('compile', () => {
  it('compiles a source node', () => {
    expect(compile(cleanFlow(), { nodeId: 'src' }).sql).toMatchSnapshot();
  });

  it('compiles a transform node as one CTE per step', () => {
    expect(compile(cleanFlow(), { nodeId: 'clean' }).sql).toMatchSnapshot();
  });

  it('compiles an output node as its input', () => {
    const c = compile(cleanFlow(), { nodeId: 'out' });
    expect(c.sql).toBe(compile(cleanFlow(), { nodeId: 'clean' }).sql);
    expect(c.nodeIds).toEqual(['src', 'clean', 'out']);
  });

  it('compiles a transform with no steps (a Check node) as a pass-through', () => {
    expect(compile(cleanFlow([]), { nodeId: 'clean' }).sql).toMatchSnapshot();
  });

  it('previews step k with steps 0..k only', () => {
    const sql = compile(cleanFlow(), { nodeId: 'clean', stepIndex: 0 }).sql;
    expect(sql).toContain('trim(');
    expect(sql).not.toContain('upper(');
  });

  it('leaves disabled steps out of the SQL', () => {
    const sql = compile(cleanFlow([step('s1', 'trimWhitespace', { columns: ['name'] }, false), step('s2', 'removeColumns', { columns: ['email'] })]), { nodeId: 'clean' }).sql;
    expect(sql).not.toContain('trim(');
    expect(sql).toMatchSnapshot();
  });

  it('pages and counts', () => {
    expect(compilePreview(cleanFlow(), { nodeId: 'out' }, 2)).toMatch(/LIMIT 500 OFFSET 1000$/);
    expect(compileCount(cleanFlow(), { nodeId: 'out' })).toMatch(/^SELECT COUNT\(\*\) AS n FROM \(WITH/);
    expect(() => compilePreview(cleanFlow(), { nodeId: 'out' }, -1)).toThrow(RangeError);
  });

  it('quotes awkward column and node names', () => {
    const p = flow({
      sources: [src({ id: 'a"b', format: 'csv' })],
      nodes: [
        { id: 'n"1', type: 'source', sourceId: 'a"b' },
        { id: 't', type: 'transform', steps: [step('s', 'renameColumns', { renames: [{ from: 'first "name"', to: "it's" }] })] },
      ],
      wires: [['n"1', 't']],
    });
    expect(compile(p, { nodeId: 't' }).sql).toMatchSnapshot();
  });
});

describe('step snapshots', () => {
  it.each([
    ['trimWhitespace', { columns: ['name', 'email'] }],
    ['changeCase', { columns: ['name'], mode: 'upper' }],
    ['changeCase', { columns: ['name'], mode: 'lower' }],
    ['changeCase', { columns: ['name'], mode: 'title' }],
    ['changeCase', { columns: ['name'], mode: 'sentence' }],
    ['renameColumns', { renames: [{ from: 'name', to: 'full_name' }, { from: 'joined', to: 'joined_on' }] }],
    ['removeColumns', { columns: ['email'] }],
    ['reorderColumns', { columns: ['email', 'id'] }],
    ['changeType', { columns: ['id'], to: 'text', onError: 'empty' }],
    ['changeType', { columns: ['joined', 'id'], to: 'date', onError: 'fail' }],
    ['splitByDelimiter', { column: 'email', delimiter: '@', into: ['user', 'domain'], keepOriginal: false }],
    ['splitByDelimiter', { column: 'name', delimiter: "'", into: ['a'], keepOriginal: true }],
    ['splitByPosition', { column: 'joined', positions: [4, 7], into: ['year', 'dash_month', 'dash_day'], keepOriginal: true }],
    ['mergeColumns', { columns: ['name', 'email'], separator: ' <', into: 'contact', keepOriginals: false }],
    ['addIndex', { name: 'row', start: 1 }],
    ['addIndex', { name: 'row', start: 0 }],
    ['duplicateColumn', { column: 'email', into: 'email copy' }],
    ['addColumn', { name: 'domain', expression: "split_part(email, '@', 2)" }],
    ['filterRows', { mode: 'keep', match: 'all', conditions: [{ column: 'email', op: 'contains', value: "O'Brien" }], matchCase: false }],
    ['filterRows', { mode: 'remove', match: 'any', conditions: [{ column: 'id', op: 'greater', value: '2' }, { column: 'name', op: 'empty', value: '' }], matchCase: true }],
    ['sortRows', { keys: [{ column: 'joined', descending: true }, { column: 'id', descending: false }] }],
    ['removeRows', { from: 'top', count: 2 }],
    ['removeRows', { from: 'bottom', count: 1 }],
    ['removeBlankRows', { columns: [] }],
    ['removeBlankRows', { columns: ['name', 'email'] }],
    ['duplicateRows', { columns: [], keep: 'first' }],
    ['duplicateRows', { columns: ['email'], keep: 'duplicates' }],
    ['fillRows', { columns: ['name'], direction: 'down' }],
    ['fillRows', { columns: ['name', 'email'], direction: 'up' }],
    ['promoteHeaders', { renames: [{ from: 'id', to: 'ID' }, { from: 'name', to: 'name' }] }],
    ['findReplace', { columns: ['email'], find: 'example.com', replace: "o'brien.org", regex: false, matchCase: true }],
    ['findReplace', { columns: ['email'], find: 'A.B', replace: 'x\\1', regex: false, matchCase: false }],
    ['findReplace', { columns: ['name', 'email'], find: '\\s+', replace: ' ', regex: true, matchCase: true }],
    ['extractText', { column: 'email', mode: 'prefix', length: 3, into: 'start' }],
    ['extractText', { column: 'email', mode: 'suffix', length: 4, into: 'tld' }],
    ['extractText', { column: 'email', mode: 'between', start: '@', end: '.', into: 'host' }],
    ['extractText', { column: 'joined', mode: 'regex', pattern: '^([0-9]{4})', group: 1, into: 'year' }],
    ['padText', { columns: ['id'], length: 5, character: '0', side: 'start' }],
    ['padText', { columns: ['name'], length: 20, character: '.', side: 'end' }],
    ['textLength', { column: 'name', into: 'name_length' }],
    ['parseDates', { columns: ['joined'], formats: ['%d/%m/%Y'], onError: 'empty' }],
    ['collapseSpaces', { columns: ['name', 'email'] }],
    ['removeNonPrinting', { columns: ['name'] }],
    ['emptyToNull', { columns: ['name', 'id'] }],
    ['parseNumbers', { columns: ['id'], decimal: '.' }],
    ['parseNumbers', { columns: ['id'], decimal: ',' }],
    ['parseDates', { columns: ['joined'], formats: ['%Y-%m-%d %H:%M:%S', "%d %b '%y"], onError: 'fail' }],
    ['extractDatePart', { columns: ['joined'], part: 'year', replace: false }],
    ['extractDatePart', { columns: ['joined', 'id'], part: 'weekdayName', replace: true }],
    ['shiftDates', { columns: ['joined'], direction: 'add', by: 'fixed', amount: 2, unit: 'quarters', keepTime: false }],
    ['shiftDates', { columns: ['joined'], direction: 'subtract', by: 'column', amountColumn: 'id', unit: 'seconds', keepTime: true }],
    ['dateDifference', { start: 'joined', end: 'left on', unit: 'weeks', into: 'tenure' }],
    ['truncateDates', { columns: ['joined'], to: 'quarter' }],
    ['formatDates', { columns: ['joined'], format: "%d %b '%y" }],
    ['roundNumbers', { columns: ['id'], mode: 'places', places: 0 }],
    ['roundNumbers', { columns: ['id'], mode: 'places', places: 2 }],
    ['roundNumbers', { columns: ['id'], mode: 'up', places: 1 }],
    ['roundNumbers', { columns: ['id'], mode: 'down', places: 0 }],
    ['roundNumbers', { columns: ['id'], mode: 'nearest', places: 0, nearest: 0.05 }],
    ['absoluteValue', { columns: ['id'] }],
    ['bucketNumbers', { column: 'id', mode: 'width', width: 10, start: 0, edges: [], into: 'band' }],
    ['bucketNumbers', { column: 'id', mode: 'width', width: 0.5, start: -1, edges: [], into: 'band' }],
    ['bucketNumbers', { column: 'id', mode: 'edges', edges: [18, 65], into: "o'clock" }],
    ['standardise', { columns: ['id'], method: 'zscore' }],
    ['standardise', { columns: ['id'], method: 'minmax' }],
    ['convertUnits', { columns: ['id'], from: 'mi', to: 'km' }],
    ['convertUnits', { columns: ['id'], from: 'f', to: 'c' }],
  ])('%s %j', (type, params) => {
    expect(compile(cleanFlow([step('s', type, params)]), { nodeId: 'clean' }).sql).toMatchSnapshot();
  });
});

describe('errors', () => {
  it('names the node that has no input', () => {
    const p = flow({ nodes: [{ id: 't', type: 'transform' }] });
    // An empty input is its own kind of CompileError, so the canvas can call the node unwired rather than broken.
    expect(() => compile(p, { nodeId: 't' })).toThrow(new UnwiredError('t has no input. Connect a wire into it.', 't', 0));
    expect(() => compile(p, { nodeId: 't' })).toThrow(CompileError);
  });

  it('rejects unknown step types and bad params with the step named', () => {
    expect(() => compile(cleanFlow([step('s', 'nope', {})]), { nodeId: 'clean' })).toThrow(/unknown type/);
    expect(() => compile(cleanFlow([step('s', 'trimWhitespace', { columns: [] })]), { nodeId: 'clean' })).toThrow(/invalid settings: columns pick at least one column/);
  });

  it('reports a missing source and a missing node', () => {
    const p = cleanFlow();
    expect(() => compile({ ...p, sources: [] }, { nodeId: 'out' })).toThrow(/lost its source/);
    expect(() => compile(p, { nodeId: 'ghost' })).toThrow(/no longer exists/);
    expect(() => compile(p, { nodeId: 'clean', stepIndex: 5 })).toThrow(/no step 6/);
  });
});

describe('upstreamKey', () => {
  it('ignores names, notes, positions and downstream edits', () => {
    const p = cleanFlow();
    const key = upstreamKey(p, { nodeId: 'clean' });
    const moved = { ...p, name: 'Other', nodes: p.nodes.map((n) => ({ ...n, name: 'x', notes: 'y', position: { x: 9, y: 9 } })) };
    expect(upstreamKey(moved, { nodeId: 'clean' })).toBe(key);
    const addedDownstream = { ...p, nodes: p.nodes.map((n) => (n.type === 'output' ? { ...n, outputSpec: { format: 'parquet' as const, options: {} } } : n)) };
    expect(upstreamKey(addedDownstream, { nodeId: 'clean' })).toBe(key);
  });

  it('changes when steps, options or the file change, and differs per step', () => {
    const p = cleanFlow();
    const key = upstreamKey(p, { nodeId: 'clean' });
    expect(upstreamKey(p, { nodeId: 'clean', stepIndex: 0 })).not.toBe(key);
    expect(upstreamKey(cleanFlow([step('s1', 'trimWhitespace', { columns: ['email'] })]), { nodeId: 'clean' })).not.toBe(key);
    expect(upstreamKey({ ...p, sources: [src({ id: 'cust', format: 'csv', parseOptions: { delimiter: ';' } })] }, { nodeId: 'clean' })).not.toBe(key);
    expect(upstreamKey({ ...p, sources: [src({ id: 'cust', format: 'csv', file: { originalName: 'c.csv', size: 1, lastModified: 0, headHash: 'abc' } })] }, { nodeId: 'clean' })).not.toBe(key);
  });

  it('changes when a URL source’s address or fetched file changes', () => {
    const at = (href: string, headHash?: string) => upstreamKey({ ...cleanFlow(), sources: [src({ id: 'cust', format: 'csv', kind: 'url', url: { href, headHash } })] }, { nodeId: 'clean' });
    const key = at('https://x.org/a.csv', 'h1');
    expect(at('https://x.org/a.csv', 'h1')).toBe(key);
    expect(at('https://x.org/a.csv', 'h2')).not.toBe(key);
    expect(at('https://x.org/b.csv', 'h1')).not.toBe(key);
  });
});

describe('SchemaCache', () => {
  it('describes once per upstream state and retries after a failure', async () => {
    let calls = 0;
    let fail = true;
    const cache = new SchemaCache(async () => {
      calls++;
      if (fail) throw new Error('boom');
      return [{ name: 'id', type: 'BIGINT' }];
    }, 2);
    const p = cleanFlow();
    await expect(cache.get(p, { nodeId: 'clean' })).rejects.toThrow('boom');
    fail = false;
    expect(await cache.get(p, { nodeId: 'clean' })).toEqual([{ name: 'id', type: 'BIGINT' }]);
    await cache.get({ ...p, name: 'renamed' }, { nodeId: 'clean' });
    expect(calls).toBe(2);
    await cache.get(p, { nodeId: 'src' });
    await cache.get(p, { nodeId: 'clean', stepIndex: 0 });
    expect(cache.size).toBe(2);
  });
});

describe('results table queries', () => {
  it('casts each column to text for display and pages with LIMIT and OFFSET', () => {
    const sql = compileDisplayPage(cleanFlow(), { nodeId: 'out' }, ['id', 'na"me'], 2, 100);
    expect(sql).toContain('SELECT CAST("id" AS VARCHAR) AS "id", CAST("na""me" AS VARCHAR) AS "na""me" FROM (WITH');
    expect(sql.endsWith('LIMIT 100 OFFSET 200')).toBe(true);
    expect(compileDisplayPage(cleanFlow(), { nodeId: 'out' }, [])).toMatch(/^SELECT \* FROM \(/);
    expect(() => compileDisplayPage(cleanFlow(), { nodeId: 'out' }, [], -1)).toThrow(RangeError);
  });

  it('profiles through SUMMARIZE', () => {
    expect(compileProfile(cleanFlow(), { nodeId: 'out' })).toMatchSnapshot();
  });

  it('checks what text columns look like, one set of counts per column', () => {
    expect(compileTypeSniff(cleanFlow(), { nodeId: 'out' }, ['joined', 'na"me'])).toMatchSnapshot();
    expect(() => compileTypeSniff(cleanFlow(), { nodeId: 'out' }, [])).toThrow(RangeError);
  });
});

describe('column step settings', () => {
  const invalid = (type: string, params: Record<string, unknown>) => () => compile(cleanFlow([step('s', type, params)]), { nodeId: 'clean' });

  it('refuses expressions that could end the query early', () => {
    expect(expressionProblem("split_part(email, ';', 2)")).toBeUndefined();
    expect(expressionProblem('"odd;name" + 1')).toBeUndefined();
    expect(expressionProblem('1; DROP TABLE x')).toMatch(/without ;/);
    expect(expressionProblem('1 -- hide the rest')).toMatch(/comments/);
    expect(expressionProblem('1 /* hide')).toMatch(/comments/);
    expect(expressionProblem("'open")).toMatch(/quote/);
    expect(invalid('addColumn', { name: 'x', expression: '1; select 2' })).toThrow(CompileError);
  });

  it('needs positions in order and one more name than positions', () => {
    expect(invalid('splitByPosition', { column: 'id', positions: [3, 2], into: ['a', 'b', 'c'] })).toThrow(/smallest to largest/);
    expect(invalid('splitByPosition', { column: 'id', positions: [2], into: ['a'] })).toThrow(/one more column/);
    expect(invalid('mergeColumns', { columns: ['name'], into: 'x' })).toThrow(/at least two/);
    expect(invalid('splitByDelimiter', { column: 'id', delimiter: '', into: ['a'] })).toThrow(/delimiter/);
  });

  it('says how to fix a pattern DuckDB would refuse, before anything runs', () => {
    expect(regexProblem('^[0-9]+$')).toBeUndefined();
    expect(regexProblem('\\-')).toBeUndefined();
    expect(regexProblem('(abc')).toBe('close every ( with a )');
    expect(regexProblem('[abc')).toBe('close every [ with a ]');
    expect(regexProblem('*a')).toMatch(/put something before/);
    expect(regexProblem('a(?=b)')).toMatch(/look-aheads/);
    expect(regexProblem('(a)\\1')).toMatch(/back-references/);
    expect(invalid('findReplace', { columns: ['name'], find: '(', regex: true })).toThrow(/close every \(/);
    expect(invalid('findReplace', { columns: ['name'], find: '(', regex: false })).not.toThrow();
    expect(invalid('extractText', { column: 'name', mode: 'regex', pattern: '[', into: 'x' })).toThrow(/close every \[/);
    expect(invalid('padText', { columns: ['id'], length: 3, character: '00' })).toThrow(/one character/);
  });

  it('detects date formats on a sample of non-empty values, one constant format per SELECT', () => {
    const sql = compileDateDetection(cleanFlow(), { nodeId: 'clean' }, 'joined', ['%Y-%m-%d', '%d/%m/%Y']);
    expect(sql).toMatchSnapshot();
    expect(() => compileDateDetection(cleanFlow(), { nodeId: 'clean' }, 'joined', [])).toThrow(RangeError);
    expect(invalid('parseDates', { columns: ['joined'], formats: [] })).toThrow(/choose a date format/);
  });

  it('row steps say what is missing', () => {
    expect(invalid('filterRows', { conditions: [{ column: 'id', op: 'equals', value: '' }] })).toThrow(/value to compare/);
    expect(invalid('filterRows', { conditions: [{ column: 'id', op: 'empty' }] })).not.toThrow();
    expect(invalid('removeRows', { from: 'top', count: 0 })).toThrow(/at least one row/);
    expect(invalid('sortRows', { keys: [] })).toThrow(/sort by/);
  });
});

describe('quality rules', () => {
  const rule = (id: string, type: string, params: Record<string, unknown>, severity: 'fail' | 'warn' = 'fail') => ({ id, type, label: `${type} ${id}`, enabled: true, severity, params });
  const withRules = (rules: ReturnType<typeof rule>[]) => {
    const p = cleanFlow();
    return { ...p, nodes: p.nodes.map((n) => (n.id === 'clean' ? { ...n, rules } : n)) };
  };

  it.each([
    ['notEmpty', { column: 'email' }],
    ['unique', { columns: ['id'] }],
    ['unique', { columns: ['name', 'email'] }],
    ['matchesPattern', { column: 'email', preset: 'email' }],
    ['matchesPattern', { column: 'id', preset: 'custom', pattern: "^[0-9]+'$" }],
    ['noEdgeSpaces', { column: 'name' }],
    ['inSet', { column: 'name', values: ['Ann', "O'Neil"], matchCase: true }],
    ['inSet', { column: 'name', values: ['Ann'], matchCase: false }],
    ['inRange', { column: 'id', min: '1', max: '10' }],
    ['inRange', { column: 'joined', min: '2020-01-01', max: '' }],
  ])('%s %j', (type, params) => {
    expect(rulePredicate({ type, params, label: type })).toMatchSnapshot();
  });

  it('counts every rule’s failures over the node’s output in one query', () => {
    const p = withRules([rule('r1', 'notEmpty', { column: 'email' }), rule('r2', 'unique', { columns: ['id'] })]);
    expect(compileRules(p, 'clean', p.nodes[1]!.rules)).toMatchSnapshot();
  });

  it('shows only the rows a rule fails, keyed apart from the full preview', () => {
    const p = withRules([rule('r1', 'notEmpty', { column: 'email' })]);
    const sql = compile(p, { nodeId: 'clean', failingRuleId: 'r1' }).sql;
    expect(sql).toContain('WHERE NOT coalesce("__puddle_pass", false)');
    expect(sql).toMatchSnapshot();
    expect(upstreamKey(p, { nodeId: 'clean', failingRuleId: 'r1' })).not.toBe(upstreamKey(p, { nodeId: 'clean' }));
    expect(() => compile(p, { nodeId: 'clean', failingRuleId: 'gone' })).toThrow(/no such rule/);
  });

  it('names the rule whose settings are incomplete', () => {
    expect(() => rulePredicate({ type: 'inRange', params: { column: 'id', min: '', max: '' }, label: 'Range' })).toThrow(/Rule "Range" has invalid settings: min give a lowest or highest value/);
    expect(() => rulePredicate({ type: 'matchesPattern', params: { column: 'id', preset: 'custom', pattern: '' }, label: 'P' })).toThrow(/give a pattern/);
    expect(() => rulePredicate({ type: 'nope', params: {}, label: 'X' })).toThrow(/unknown type/);
  });
});

describe('engine settings', () => {
  it('points extension installs and autoloads at a quoted repository', () => {
    expect(setExtensionRepository("https://x.example/it's")).toEqual([
      "SET custom_extension_repository = 'https://x.example/it''s'",
      "SET autoinstall_extension_repository = 'https://x.example/it''s'",
    ]);
  });
});
