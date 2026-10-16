export type EngineErrorCode =
  | 'cancelled'
  | 'stopped'
  | 'syntax'
  | 'missing'
  | 'conversion'
  | 'io'
  | 'out-of-memory'
  | 'missing-extension'
  | 'invalid-input'
  | 'not-ready'
  | 'unknown';

/** A typed engine error with a message the UI can show as is. `detail` keeps DuckDB's own text. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly detail?: string;

  constructor(code: EngineErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
  }
}

export const cancelled = () => new EngineError('cancelled', 'The query was replaced by a newer one.');

export const isCancelled = (e: unknown): e is EngineError => e instanceof EngineError && e.code === 'cancelled';

/** Someone pressed Stop. Unlike a superseded query, this is shown, with a way to run it again. */
export const stopped = () => new EngineError('stopped', 'Stopped before it finished.');

export const isStopped = (e: unknown): e is EngineError => e instanceof EngineError && e.code === 'stopped';

const firstLine = (s: string) => s.split('\n')[0]!.trim();

/** Turn whatever DuckDB threw into an EngineError that says what happened and how to fix it. */
export function toEngineError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const line = firstLine(raw);
  const body = line.replace(/^[A-Za-z ]+ Error:\s*/, '');

  if (/interrupt/i.test(raw)) return new EngineError('cancelled', 'The query was cancelled.', raw);
  if (/^Parser Error/i.test(line)) return new EngineError('syntax', `The SQL couldn't be read: ${body}. Check the expression for typos.`, raw);
  const ext = /exists in the (\w+) extension/i.exec(raw) ?? /extension "?(\w+)"? (?:is not|not) (?:installed|loaded|found)/i.exec(raw);
  if (ext) return new EngineError('missing-extension', `This needs DuckDB's ${ext[1]} extension, which couldn't be loaded. Check your connection and try again.`, raw);
  if (/^(Binder|Catalog) Error/i.test(line)) {
    const col = /column "?([^"\s]+)"? not found/i.exec(raw) ?? /Referenced column "?([^"\s]+)"?/i.exec(raw);
    if (col) return new EngineError('missing', `Column ${col[1]} doesn't exist at this point in the flow. Pick a column that exists upstream.`, raw);
    // A date or number function given text: say which step reads it, not DuckDB's candidate list.
    if (/No function matches the given name and argument types '[^']*\(.*VARCHAR/i.test(raw))
      return new EngineError('missing', 'A column used here is text where dates or numbers are needed. Add a Parse dates or Parse numbers step before this one.', raw);
    const table = /Table with name ([^\s]+) does not exist/i.exec(raw);
    if (table) return new EngineError('missing', `${table[1]} isn't loaded. Re-select the file for this source.`, raw);
    return new EngineError('missing', `${body}.`, raw);
  }
  if (/^Conversion Error/i.test(line)) return new EngineError('conversion', `Some values couldn't be converted: ${body}. Fix or filter those rows first, or choose another type.`, raw);
  if (/^IO Error/i.test(line)) return new EngineError('io', `The file couldn't be read: ${body}. Check the file and its parse options.`, raw);
  if (/^Out of Memory/i.test(line) || /out of memory/i.test(raw)) return new EngineError('out-of-memory', 'The browser ran out of memory for this query. Try sample mode or fewer columns.', raw);
  if (/^Invalid Input Error/i.test(line)) return new EngineError('invalid-input', `${body}. Check the parse options for this source.`, raw);
  return new EngineError('unknown', body || 'Something went wrong in the engine.', raw);
}
