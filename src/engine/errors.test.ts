import { EngineError, toEngineError } from './errors';

describe('toEngineError', () => {
  it.each([
    ['Parser Error: syntax error at or near "SELEC"\n\nLINE 1: SELEC 1', 'syntax', /couldn't be read: syntax error at or near "SELEC"/],
    ['Binder Error: Referenced column "order_dt" not found in FROM clause!', 'missing', /Column order_dt doesn't exist at this point in the flow/],
    ["Binder Error: No function matches the given name and argument types 'year(VARCHAR)'. You might need to add explicit type casts.", 'missing', /text where dates or numbers are needed. Add a Parse dates or Parse numbers step/],
    ["Binder Error: No function matches the given name and argument types 'round(VARCHAR, INTEGER_LITERAL)'.", 'missing', /Parse numbers/],
    ['Catalog Error: Table with name src_x does not exist!', 'missing', /src_x isn't loaded/],
    ['Conversion Error: Could not convert string \'abc\' to INT32', 'conversion', /couldn't be converted/],
    ['IO Error: No files found that match the pattern "x.csv"', 'io', /file couldn't be read/],
    ['Out of Memory Error: failed to allocate data of size 2.0 GiB', 'out-of-memory', /ran out of memory/],
    ['Invalid Input Error: Error when sniffing file', 'invalid-input', /parse options/],
    ['Catalog Error: Table Function with name "read_json_auto" is not in the catalog, but it exists in the json extension.', 'missing-extension', /needs DuckDB's json extension/],
    ['INTERRUPT Error: Interrupted!', 'cancelled', /cancelled/],
    // A step's own check (stepFailure) is shown as written, without the parse options advice.
    ['Invalid Input Error: Puddle: Transpose was set up for 3 rows.', 'invalid-input', /^Transpose was set up for 3 rows\.$/],
    ['Binder Error: Cannot unpivot columns of types BIGINT and VARCHAR - an explicit cast is required.', 'conversion', /different types \(BIGINT and VARCHAR\).*Treat all values as text/],
    // A query with totals using a column it neither groups nor summarises.
    [
      'Binder Error: column "name" must appear in the GROUP BY clause or must be part of an aggregate function.\nEither add it to the GROUP BY list, or use "ANY_VALUE(name)" if the exact value of "name" is not important.',
      'invalid-input',
      /^name is used but neither grouped nor summarised\. Set its Total to Group by/,
    ],
    ['Something odd', 'unknown', /Something odd/],
  ])('%s', (raw, code, message) => {
    const e = toEngineError(new Error(raw));
    expect(e).toBeInstanceOf(EngineError);
    expect(e.code).toBe(code);
    expect(e.message).toMatch(message);
    expect(e.detail).toBe(raw);
  });

  it('passes EngineErrors through', () => {
    const e = new EngineError('io', 'x');
    expect(toEngineError(e)).toBe(e);
  });
});
