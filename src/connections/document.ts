// Document the schema: read a connection's catalogue in detail through its connector, turn it into the Phase 4
// schema model as a group named after the connection (src/schema/fromCatalog.ts), and write it into the project's
// DBML in one undo step that also saves a version and points the connection's sources at their documented tables, so
// their derived rules run on the rows and the Relationships view draws the documented refs between them.
import { connectorFor } from '../connect/browser';
import { contextFor } from '../connect/context';
import { ConnectorError, type CatalogDetail } from '../connect/types';
import { setSchemaCheck, setSchemaDbml, updateConnection, useProjectStore, type Connection, type Project } from '../model';
import type { SchemaDiff } from '../schema/diff';
import { documentDiff, documentedPart, documentedTable, documentInto, documentSchemaName, schemaFromCatalog } from '../schema/fromCatalog';
import type { DbmlSchema } from '../schema/model';
import { parseDbml } from '../schema/parse';
import { saveSchemaVersion } from '../schema/versions';
import { driver } from './drivers';

/** The catalogue in detail, from a driver that can describe its schema. */
export async function readSchemaDetail(connection: Connection): Promise<CatalogDetail> {
  const connector = await connectorFor(connection);
  if (!connector.document) throw new ConnectorError(`${driver(connection.driver).label} connections can’t describe their schema yet.`);
  return connector.document(contextFor(connection));
}

/** The day, as the group's note and the version's label say it. */
const day = (at: Date) => at.toISOString().slice(0, 10);

/** The note on the group: where the schema came from and when. */
export const documentedNote = (connection: Connection, at: Date) => `Documented from ${driver(connection.driver).label} connection ${connection.name} on ${day(at)}`;

export interface DocumentPlan {
  generated: DbmlSchema;
  /** What the group held before, with the changes documenting again makes; null the first time. */
  before: DbmlSchema | null;
  diff: SchemaDiff | null;
  /** The DBML schema the tables go in, when not the default. */
  schema?: string;
}

/** What documenting would write: the catalogue (or the tables picked from it) as a schema, and how it differs from the last time. */
export function planDocument(project: Project, connection: Connection, detail: CatalogDetail, at: Date, tables?: string[]): DocumentPlan {
  const picked = tables ? { ...detail, tables: detail.tables.filter((t) => tables.includes(t.schema ? `${t.schema}.${t.name}` : t.name)) } : detail;
  const schema = documentSchemaName(project.schema.dbml, connection.name, picked);
  const generated = schemaFromCatalog(picked, { group: connection.name, schema, note: documentedNote(connection, at) });
  const before = documentedPart(parseDbml(project.schema.dbml).schema, connection.name);
  return { generated, before, diff: before ? documentDiff(before, generated) : null, ...(schema !== 'public' ? { schema } : {}) };
}

/** The version's label: the connection and the day. */
export const documentedLabel = (connection: Connection, at: Date) => `${connection.name} documented ${day(at)}`;

/** Point every source reading a documented table of the connection at it, where it isn't checked against anything yet. */
export function checkDocumentedSources(project: Project, connection: Connection): Project {
  let next = project;
  for (const n of project.nodes) {
    if (n.type !== 'source' || n.schemaCheck) continue;
    const s = project.sources.find((x) => x.id === n.sourceId);
    if (s?.kind !== 'connection' || s.connection?.connectionId !== connection.id || !s.connection.table) continue;
    const t = documentedTable(project.schema.dbml, connection.name, s.connection.table);
    if (t) next = setSchemaCheck(next, n.id, { ...t, mapping: {} });
  }
  return next;
}

/** Write the plan into the project: the DBML, a version labelled with the connection and the day, the connection's documentedAt, and the sources' checks; one undo step. */
export function applyDocument(connection: Connection, plan: DocumentPlan, at: Date): void {
  const store = useProjectStore.getState();
  store.batch(() => {
    store.apply((p) => {
      let next = setSchemaDbml(p, documentInto(p.schema.dbml, plan.generated, connection.name));
      next = saveSchemaVersion(next, documentedLabel(connection, at), at).project;
      next = updateConnection(next, connection.id, { documentedAt: at.toISOString() });
      return checkDocumentedSources(next, connection);
    });
  });
}

/** The docs export's cover line: which connections the schema was documented from, and when. */
export function documentedCover(connections: Connection[]): string | undefined {
  const done = connections.filter((c) => c.documentedAt);
  if (!done.length) return undefined;
  return `Documented from ${done.map((c) => `${c.name} (${driver(c.driver).label}, read ${day(new Date(c.documentedAt!))})`).join(', ')}`;
}
