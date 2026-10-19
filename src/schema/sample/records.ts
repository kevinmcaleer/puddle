// Generated rows written into the DBML: one top-level `records schema.table(cols) [example] { ... }` block per table,
// written by writeDbml so it reads back as the same rows, and appended to the project's text.
import { emptySchema, type DbmlSchema, type Range, type RecordValue } from '../model';
import { writeDbml } from '../write';
import type { GeneratedTable } from './generate';

/** One table's generated rows as a top-level DBML records block; `example` keeps them out of the built tables. */
export function recordsBlock(gen: GeneratedTable, options: { example: boolean }): string {
  const records = [{ schema: gen.schema, table: gen.table, columns: gen.columns, implicit: false, inline: false, example: options.example, rows: gen.rows }];
  return writeDbml({ ...emptySchema(), records }).replace(/\n+$/, '');
}

/** The DBML text with the blocks appended after a blank line, each block apart from the next. */
export function addRecords(dbml: string, blocks: string[]): string {
  if (!blocks.length) return dbml;
  const body = dbml.replace(/\s+$/, '');
  return `${body ? `${body}\n\n` : ''}${blocks.join('\n\n')}\n`;
}

/**
 * The DBML with generated rows added: a table without records gets a new block; one that has records (a table takes
 * one block) has its block rewritten at the end of the text with the new rows after its own, keeping whether it is an
 * example, and the columns of both.
 */
export function fillRecords(dbml: string, schema: DbmlSchema, tables: GeneratedTable[], options: { example: boolean }): string {
  const cuts: Range[] = [];
  const blocks = tables.map((gen) => {
    const had = schema.records.find((r) => r.schema === gen.schema && r.table === gen.table);
    if (!had?.range) return recordsBlock(gen, options);
    cuts.push(had.range);
    const columns = [...had.columns, ...gen.columns.filter((c) => !had.columns.includes(c))];
    const fill = (from: string[], row: RecordValue[]) => columns.map((c) => (from.includes(c) ? row[from.indexOf(c)]! : { kind: 'null' as const, value: 'null' }));
    const rows = [...had.rows.map((r) => fill(had.columns, r)), ...gen.rows.map((r) => fill(gen.columns, r))];
    return recordsBlock({ ...gen, columns, rows }, { example: had.example });
  });
  let text = dbml;
  for (const r of cuts.sort((a, b) => b.start - a.start)) text = text.slice(0, r.start) + text.slice(r.end).replace(/^[ \t]*\n/, '');
  return addRecords(text, blocks);
}
