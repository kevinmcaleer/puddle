// The schema as a Mermaid `erDiagram`, for READMEs and anywhere else Mermaid renders (GitHub among them): each table
// with its typed columns and PK, FK and UK marks, and each ref as a relationship with crow's-foot ends.
import { qualified, type DbmlSchema, type Ref, type Table } from './model';
import { visibleColumns, type DetailLevel } from './diagram/geometry';

/** A name Mermaid reads as one word: letters, digits, `_` and `-`. */
const word = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');

/** A type Mermaid reads as one word: brackets and parentheses are allowed, commas and spaces are not. */
const typeWord = (type: string) => type.trim().replace(/,\s*/g, '-').replace(/[^A-Za-z0-9_\-[\]()]/g, '_');

const entity = (schema: string, table: string) => word(qualified(schema, table));

/** The marks on each end: left for the `from` side, right for the `to` side. */
function ends(r: Ref): [string, string] {
  // An end is "zero or …" when the other side's rows don't have to match it (that side is optional).
  // A many end is always zero or more.
  const fromMany = r.op === '>' || r.op === '<>';
  const toMany = r.op === '<' || r.op === '<>';
  const left = fromMany ? '}o' : r.toOptional ? '|o' : '||';
  const right = toMany ? 'o{' : r.fromOptional ? 'o|' : '||';
  return [left, right];
}

/** The schema as Mermaid: the tables shown (all when `only` is absent), at a detail level, and the refs between them. */
export function writeMermaid(schema: DbmlSchema, options: { detail?: DetailLevel; only?: Set<string> } = {}): string {
  const shown = (t: Pick<Table, 'schema' | 'name'>) => !options.only || options.only.has(`table:${t.schema}.${t.name}`);
  const tables = schema.tables.filter(shown);
  const fks = new Set<string>();
  for (const r of schema.refs) {
    const child = r.op === '<' ? r.to : r.from;
    if (r.op !== '<>') for (const c of child.columns) fks.add(`${child.schema}.${child.table}.${c}`);
  }
  const out = ['erDiagram'];
  for (const t of tables) {
    const columns = visibleColumns(schema, t, options.detail ?? 'full');
    if (!columns.length) {
      out.push(`  ${entity(t.schema, t.name)}`);
      continue;
    }
    out.push(`  ${entity(t.schema, t.name)} {`);
    for (const c of columns) {
      const keys = [c.pk && 'PK', fks.has(`${t.schema}.${t.name}.${c.name}`) && 'FK', c.unique && !c.pk && 'UK'].filter(Boolean);
      out.push(`    ${typeWord(c.type)} ${word(c.name)}${keys.length ? ` ${keys.join(', ')}` : ''}${c.note ? ` "${c.note.replace(/"/g, "'").replace(/\s*\n\s*/g, ' ')}"` : ''}`);
    }
    out.push('  }');
  }
  for (const r of schema.refs) {
    if (r.inactive || !shown({ schema: r.from.schema, name: r.from.table }) || !shown({ schema: r.to.schema, name: r.to.table })) continue;
    const [left, right] = ends(r);
    const label = r.from.columns.length === 1 && r.to.columns.length === 1 ? r.from.columns[0]! : r.from.columns.join(', ');
    out.push(`  ${entity(r.from.schema, r.from.table)} ${left}--${right} ${entity(r.to.schema, r.to.table)} : "${label}"`);
  }
  return `${out.join('\n')}\n`;
}
