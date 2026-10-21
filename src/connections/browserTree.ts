// The database browser's tree, pure: a connection's catalogue grouped by schema, filtered by a search over names.
import type { Catalog, CatalogTable } from '../model';
import { tableName } from '../sources/connection';

export interface SchemaGroup {
  /** The schema's name, or undefined for the database's default schema (listed first, without a heading). */
  schema?: string;
  tables: CatalogTable[];
}

/** Tables grouped by schema: the default schema first, the rest by name; tables before views, each by name. */
export function buildTree(catalog: Catalog | undefined): SchemaGroup[] {
  const groups = new Map<string | undefined, CatalogTable[]>();
  for (const t of catalog?.tables ?? []) {
    const list = groups.get(t.schema) ?? [];
    list.push(t);
    groups.set(t.schema, list);
  }
  const order = (a: CatalogTable, b: CatalogTable) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'table' ? -1 : 1);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === undefined ? -1 : b === undefined ? 1 : a.localeCompare(b)))
    .map(([schema, tables]) => ({ schema, tables: [...tables].sort(order) }));
}

/**
 * The tree with only what the search matches: a table whose name (with its schema) or any column name contains the
 * words, case-insensitively; a matching table keeps every column. An empty search is the whole tree.
 */
export function filterTree(tree: SchemaGroup[], search: string): SchemaGroup[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tree;
  const matches = (t: CatalogTable) => {
    const names = [tableName(t).toLowerCase(), ...t.columns.map((c) => c.name.toLowerCase())];
    return words.every((w) => names.some((n) => n.includes(w)));
  };
  return tree.map((g) => ({ ...g, tables: g.tables.filter(matches) })).filter((g) => g.tables.length);
}

/** "3 tables, 1 view" for the pane's heading. */
export function countLabel(catalog: Catalog | undefined): string {
  const tables = catalog?.tables.filter((t) => t.kind === 'table').length ?? 0;
  const views = catalog?.tables.filter((t) => t.kind === 'view').length ?? 0;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return views ? `${part(tables, 'table')}, ${part(views, 'view')}` : part(tables, 'table');
}

/** The drag payload for a table dragged from the browser onto the canvas. */
export const TABLE_DRAG_TYPE = 'application/x-puddle-table';
export interface TableDrag {
  connectionId: string;
  table: { schema?: string; name: string };
}
