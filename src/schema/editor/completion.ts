// What the DBML editor suggests at the caret: keywords where an element starts, settings inside brackets, types after
// a column name, and the schema's own tables, columns and enums where a ref or group names them.
import { lex } from '../lexer';
import { qualified, type DbmlSchema } from '../model';
import { dbmlName } from '../write';

export type CompletionKind = 'keyword' | 'setting' | 'type' | 'table' | 'column' | 'enum';

export interface Completion {
  label: string;
  kind: CompletionKind;
  /** What replaces the word being typed. */
  insert: string;
}

export interface CompletionContext {
  /** Where the word being typed starts; it ends at the caret. */
  start: number;
  word: string;
  items: Completion[];
}

const TOP = ['Table', 'Ref', 'Enum', 'TableGroup', 'TablePartial', 'Note', 'Project', 'records'];
const IN_TABLE = ['indexes', 'checks', 'Note', 'records'];
const COLUMN_SETTINGS = ['pk', 'primary key', 'not null', 'null', 'unique', 'increment', 'default: ', 'note: ', 'ref: ', 'check: '];
const TYPES = ['integer', 'bigint', 'smallint', 'int', 'decimal(10,2)', 'numeric', 'float', 'double', 'real', 'varchar', 'varchar(255)', 'char', 'text', 'boolean', 'date', 'time', 'timestamp', 'timestamptz', 'interval', 'uuid', 'json', 'jsonb', 'blob'];
const REF_SETTINGS = ['delete: cascade', 'delete: restrict', 'delete: set null', 'delete: set default', 'delete: no action', 'update: cascade', 'update: restrict', 'update: set null', 'color: ', 'inactive'];

/** The suggestions for the word ending at `caret`, best first, or none. */
export function completions(text: string, caret: number, schema: DbmlSchema): CompletionContext {
  const before = text.slice(0, caret);
  const word = /[\p{L}\p{N}_$.]*$/u.exec(before)![0];
  const start = caret - word.length;
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.slice(lineStart, start);
  const block = enclosingBlock(text.slice(0, lineStart));
  const openBracket = line.lastIndexOf('[') > line.lastIndexOf(']');
  const tables = schema.tables.map((t) => qualified(t.schema, t.name));
  const columns = schema.tables.flatMap((t) => t.columns.map((c) => `${qualified(t.schema, t.name)}.${dbmlName(c.name)}`));

  let items: Completion[] = [];
  if (openBracket) {
    const setting = line.slice(line.lastIndexOf('[') + 1).split(',').pop()!.trim().toLowerCase();
    if (/^ref\s*:\s*[<>-]{1,2}\??\s*$/.test(setting) || /^ref\s*:\s*$/.test(setting)) items = columns.map((c) => ({ label: c, kind: 'column', insert: c }));
    else if (setting === '' && /^\s*ref\b|:\s*\S+\.\S+\s*[<>-]/i.test(line)) items = REF_SETTINGS.map((s) => ({ label: s.trim(), kind: 'setting', insert: s }));
    else if (setting === '') items = COLUMN_SETTINGS.map((s) => ({ label: s.trim(), kind: 'setting', insert: s }));
  } else if (/^\s*$/.test(line)) {
    if (block === null) items = TOP.map((k) => ({ label: k, kind: 'keyword', insert: k }));
    else if (block === 'table' || block === 'tablepartial') items = IN_TABLE.map((k) => ({ label: k, kind: 'keyword', insert: k }));
    else if (block === 'tablegroup') items = tables.map((t) => ({ label: t, kind: 'table', insert: t }));
    else if (block === 'ref') items = columns.map((c) => ({ label: c, kind: 'column', insert: c }));
    else if (block === 'indexes' || block === 'records') {
      const owner = enclosingTable(text.slice(0, lineStart), schema);
      items = (owner?.columns ?? []).map((c) => ({ label: c.name, kind: 'column', insert: dbmlName(c.name) }));
    }
  } else if ((block === 'table' || block === 'tablepartial') && /^\s*("[^"]*"|[\p{L}\p{N}_$]+)\s+$/u.test(line)) {
    const enums = schema.enums.map((e) => qualified(e.schema, e.name));
    items = [...enums.map((e) => ({ label: e, kind: 'enum' as const, insert: e })), ...TYPES.map((t) => ({ label: t, kind: 'type' as const, insert: t }))];
  } else if (/^\s*ref\b[^:{]*:\s*$/i.test(line) || /^\s*ref\b.*[<>-]\??\s*$/i.test(line) || (block === 'ref' && /[<>-]\??\s*$/.test(line))) {
    items = columns.map((c) => ({ label: c, kind: 'column', insert: c }));
  } else if (/^\s*table\s+\S+\s+as\s*$/i.test(line)) {
    items = [];
  }
  const lower = word.toLowerCase();
  const matching = items.filter((i) => i.label.toLowerCase().startsWith(lower) && i.label.toLowerCase() !== lower);
  // Then anything that contains the word, so "id" finds orders.customer_id.
  const containing = lower ? items.filter((i) => !i.label.toLowerCase().startsWith(lower) && i.label.toLowerCase().includes(lower)) : [];
  return { start, word, items: [...matching, ...containing].slice(0, 50) };
}

/** The keyword of the innermost block open at the end of `text` (table, ref, indexes...), or null at the top level. */
export function enclosingBlock(text: string): string | null {
  const stack = blockStack(text);
  return stack.length ? stack[stack.length - 1]!.keyword : null;
}

function blockStack(text: string): { keyword: string; name: string }[] {
  const { tokens } = lex(text);
  const stack: { keyword: string; name: string }[] = [];
  let lineStart = 0;
  for (const t of tokens) {
    if (t.kind === 'newline') lineStart = t.end;
    else if (t.kind === 'punct' && t.value === '{') {
      const head = /^\s*([\p{L}_]+)\s*([^[{]*)/u.exec(text.slice(lineStart, t.start));
      const name = (head?.[2] ?? '').split(/\s+as\s+/i)[0]!.replace(/"/g, '').replace(/\s+/g, '');
      stack.push({ keyword: (head?.[1] ?? '').toLowerCase(), name });
    } else if (t.kind === 'punct' && t.value === '}') stack.pop();
  }
  return stack;
}

function enclosingTable(text: string, schema: DbmlSchema) {
  const table = blockStack(text).find((s) => s.keyword === 'table');
  if (!table) return undefined;
  const [s, n] = table.name.includes('.') ? table.name.split('.') : ['public', table.name];
  return schema.tables.find((t) => t.schema === s && t.name === n);
}
