// Relationships a database states itself, between the sources that read its tables: the foreign keys its catalogue
// declares (a SQLite file's PRAGMA foreign_key_list), or, for a database that declares none, the ones its column names
// suggest (orders.customer_id to customers.id). Read from the catalogue kept on the connection, so no read is needed.
import type { CatalogTable, Connection, Project } from '../model';

/** One pair of columns, between the nodes that read the two tables. */
export interface DatabasePair {
  from: { nodeId: string; column: string };
  to: { nodeId: string; column: string };
  connection: Connection;
  /** `database`: a foreign key the database declares. `guess`: a match of column names, in a database that declares none. */
  kind: 'database' | 'guess';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "customers" to "customer", "categories" to "category", "boxes" to "box"; a name that isn't plural stays. */
export function singular(name: string): string {
  if (/ies$/i.test(name)) return name.slice(0, -3) + 'y';
  if (/(ss|sh|ch|x|z)es$/i.test(name)) return name.slice(0, -2);
  if (/(ss|us|is)$/i.test(name)) return name;
  if (/s$/i.test(name)) return name.slice(0, -1);
  return name;
}

/** A table's single-column primary key: as the catalogue marks it, else a column named id. */
function keyOf(t: CatalogTable): string | undefined {
  const marked = t.columns.filter((c) => c.key);
  if (marked.length === 1) return marked[0]!.name;
  if (marked.length) return undefined;
  return t.columns.find((c) => norm(c.name) === 'id')?.name;
}

const sameTable = (t: CatalogTable, ref: { schema?: string; name: string }) => t.name.toLowerCase() === ref.name.toLowerCase() && (t.schema ?? '') === (ref.schema ?? '');

/**
 * The columns that refer to another table by name: a column called after the other table's singular or plural name
 * and its key (customer_id, CustomerID, customers_id for customers.id), or one named as the other table's key when
 * that key isn't plain "id" (orders.customer_code for customers.customer_code).
 */
export function guessForeignKeys(tables: CatalogTable[]): { table: CatalogTable; column: string; parent: CatalogTable; key: string }[] {
  const out: { table: CatalogTable; column: string; parent: CatalogTable; key: string }[] = [];
  for (const parent of tables) {
    if (parent.kind === 'view') continue;
    const key = keyOf(parent);
    if (!key) continue;
    const names = new Set([norm(singular(parent.name) + key), norm(parent.name + key)]);
    if (norm(key) !== 'id') names.add(norm(key));
    for (const table of tables) {
      if (table === parent) continue;
      const own = keyOf(table);
      for (const c of table.columns) {
        // A table's own plain id is never a reference, even to a table of the same name.
        if (c.name === own && norm(c.name) === 'id') continue;
        if (names.has(norm(c.name))) out.push({ table, column: c.name, parent, key });
      }
    }
  }
  return out;
}

/** The source nodes reading each table of a connection, by the table's catalogue entry. */
function nodesReading(project: Project, connection: Connection, table: CatalogTable): string[] {
  const sources = new Set(project.sources.filter((s) => s.connection?.connectionId === connection.id && s.connection.table && sameTable(table, s.connection.table)).map((s) => s.id));
  return project.nodes.filter((n) => n.type === 'source' && sources.has(n.sourceId)).map((n) => n.id);
}

/** Every pair of columns the project's databases relate, between the source nodes that read both tables. */
export function databasePairs(project: Project): DatabasePair[] {
  const pairs: DatabasePair[] = [];
  for (const connection of project.connections) {
    const tables = connection.catalog?.tables ?? [];
    if (tables.length < 2) continue;
    const read = new Map(tables.map((t) => [t, nodesReading(project, connection, t)]));
    // Two tables need to be read for there to be anything to draw.
    if ([...read.values()].filter((ids) => ids.length).length < 2) continue;
    const add = (child: CatalogTable, parent: CatalogTable, columns: string[], refColumns: string[], kind: DatabasePair['kind']) => {
      for (const from of read.get(child) ?? [])
        for (const to of read.get(parent) ?? [])
          if (from !== to) columns.forEach((c, i) => refColumns[i] && pairs.push({ from: { nodeId: from, column: c }, to: { nodeId: to, column: refColumns[i]! }, connection, kind }));
    };
    const declares = tables.some((t) => t.foreignKeys?.length);
    if (declares) {
      for (const child of tables)
        for (const fk of child.foreignKeys ?? []) {
          const parent = tables.find((t) => sameTable(t, { schema: fk.refSchema ?? child.schema, name: fk.refTable }));
          if (parent) add(child, parent, fk.columns, fk.refColumns, 'database');
        }
    } else if (tables.every((t) => t.foreignKeys)) {
      // Guessed only where the driver read foreign keys and found none, not where it can't say.
      for (const g of guessForeignKeys(tables)) add(g.table, g.parent, [g.column], [g.key], 'guess');
    }
  }
  return pairs;
}
