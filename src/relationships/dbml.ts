// The relationships view written as DBML (dbml.dbdiagram.io): a Table per table with its columns and DuckDB types,
// and a Ref per relationship, one or many at each end as the checked keys say. A column that is the one end of a
// relationship is marked unique.
import { cardinality, keyEnds, type Relationship, type RelTable, type Uniqueness } from './model';

const quote = (name: string) => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A type DBML reads bare (VARCHAR, DECIMAL(10,2), INTEGER[]); anything else (STRUCT(...), TIMESTAMP WITH TIME ZONE) is quoted. */
const typeOf = (type: string) => (/^[A-Za-z_]\w*(\(\d+(,\s*\d+)?\))?(\[\])*$/.test(type) ? type : quote(type));

/** Table names, made unique in DBML: two nodes may share a name. */
function tableNames(tables: RelTable[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const t of tables) {
    let name = t.name;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${t.name} ${i}`;
    used.add(name.toLowerCase());
    names.set(t.nodeId, name);
  }
  return names;
}

/**
 * The ref's operator: `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many. A relationship whose keys
 * haven't been checked is written many-to-one, from the column that refers to the one it refers to.
 */
export function operator(from: 'one' | 'many' | undefined, to: 'one' | 'many' | undefined): string {
  if (from === 'one' && to === 'one') return '-';
  if (from === 'one' && to === 'many') return '<';
  if (from === 'many' && to === 'many') return '<>';
  return '>';
}

export function toDbml(project: { name: string }, tables: RelTable[], relationships: Relationship[], unique: Uniqueness = {}): string {
  const names = tableNames(tables);
  const keys = keyEnds(relationships, unique);
  const lines = [`// ${project.name}: tables and relationships from Puddle`, ''];
  for (const t of tables) {
    lines.push(`Table ${quote(names.get(t.nodeId)!)} {`);
    for (const c of t.columns ?? []) {
      const settings = keys.has(`${t.nodeId}:${c.name}`) ? ' [unique]' : '';
      lines.push(`  ${quote(c.name)} ${typeOf(c.type)}${settings}`);
    }
    if (!t.columns) lines.push('  // Columns not known yet: the node is still being read, or can’t run.');
    lines.push('}', '');
  }
  for (const r of relationships) {
    const [a, b] = [names.get(r.from.nodeId), names.get(r.to.nodeId)];
    if (!a || !b) continue;
    const op = operator(cardinality(unique, r, 'from'), cardinality(unique, r, 'to'));
    lines.push(`Ref: ${quote(a)}.${quote(r.from.column)} ${op} ${quote(b)}.${quote(r.to.column)} // ${r.via.map((v) => v.label).join(', ')}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** The project's DBML with tables written from its data: after what is there already, or in its place. */
export function intoSchema(existing: string, generated: string, mode: 'append' | 'replace'): string {
  const body = existing.replace(/\s+$/, '');
  return mode === 'replace' || !body ? generated : `${body}\n\n${generated}`;
}
