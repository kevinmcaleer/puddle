// Document the schema below the UI: the file drivers describe the shop fixtures (kept in step with the recorded
// catalogues the unit tests read), and documenting a SQLite connection writes the group, the ref and a version into
// the project, checks the connection's sources against their tables so their derived rules run, and gives the
// Relationships view the ref between them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { connectorFor } from '../../src/connect/browser';
import { applyDocument, checkDocumentedSources, documentedCover, planDocument, readSchemaDetail } from '../../src/connections/document';
import { rememberConnectionFile, resetConnectionFiles } from '../../src/connections/files';
import { EngineClient } from '../../src/engine/client';
import { createProject, useProjectStore, type Connection, type Project } from '../../src/model';
import { findRelationships } from '../../src/relationships/model';
import { parseDbml } from '../../src/schema/parse';
import { addConnectionSources, readCatalog, resetConnectionSources } from '../../src/sources/connection';
import { useAttachments } from '../../src/sources/attachments';
import { inProcessClient, setSqliteClient } from '../../src/sqlite/client';
import { SqliteService } from '../../src/sqlite/service';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new File([readFileSync(join(__dirname, '../fixtures/db', name))], name);
const recorded = (driver: string) => JSON.parse(readFileSync(join(__dirname, `../fixtures/db/${driver}/catalog.json`), 'utf8'));

let engine: EngineClient;

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  setSqliteClient(inProcessClient(new SqliteService()));
  resetConnectionSources();
  resetConnectionFiles();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Documenting'));
});
afterEach(() => setSqliteClient(undefined));

const project = () => useProjectStore.getState().history.present;
const AT = new Date('2026-10-21T09:00:00Z');

function connect(driver: 'sqlite' | 'duckdb', file = driver === 'duckdb' ? 'shop.duckdb' : 'shop.sqlite'): Connection {
  const c: Connection = { id: `c-${driver}`, name: driver === 'duckdb' ? 'Shop file' : 'Shop', driver, via: 'browser', settings: { file }, auth: 'none' };
  useProjectStore.getState().apply((p) => ({ ...p, connections: [...p.connections, c] }));
  rememberConnectionFile(c.id, fixture(file));
  return c;
}

describe('the file drivers describe their schema', () => {
  it.each(['sqlite', 'duckdb'] as const)('%s: as the recorded catalogue says (regenerate tests/fixtures/db/<driver>/catalog.json when the fixture changes)', async (driver) => {
    const c = connect(driver);
    expect(await readSchemaDetail(c)).toEqual(recorded(driver));
  });

  it('says so for a driver that can’t', async () => {
    const c = connect('sqlite');
    const connector = await connectorFor(c);
    expect(connector.document).toBeDefined();
    await expect(readSchemaDetail({ ...c, driver: 'postgres', via: 'local', settings: {} })).rejects.toThrow(/can’t describe their schema|puddle-connect|reach/);
  });
});

describe('documenting a SQLite connection', () => {
  it('writes the group, the ref and a version, checks the sources against their tables, and draws the ref between them', async () => {
    const c = connect('sqlite');
    const catalog = await readCatalog(c);
    const [customers, orders] = addConnectionSources(c, { tables: catalog.tables.slice(0, 2) });
    const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!;
    expect(nodeOf(project(), customers!.id).schemaCheck).toBeUndefined();

    const detail = await readSchemaDetail(c);
    const plan = planDocument(project(), c, detail, AT);
    expect(plan.before).toBeNull();
    expect(plan.diff).toBeNull();
    expect(plan.schema).toBeUndefined();
    expect(plan.generated.tables.map((t) => t.name)).toEqual(['customers', 'orders', 'order_totals']);

    const past = useProjectStore.getState().history.past.length;
    applyDocument(c, plan, AT);
    const p = project();
    // One undo step for all of it.
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    const schema = parseDbml(p.schema.dbml);
    expect(schema.errors).toEqual([]);
    expect(schema.schema.groups).toEqual([expect.objectContaining({ name: 'Shop', tables: [{ schema: 'public', name: 'customers' }, { schema: 'public', name: 'orders' }, { schema: 'public', name: 'order_totals' }], note: 'Documented from SQLite connection Shop on 2026-10-21' })]);
    expect(schema.schema.refs).toHaveLength(1);
    expect(p.schema.versions.map((v) => [v.label, v.at])).toEqual([['Shop documented 2026-10-21', AT.toISOString()]]);
    // The version is the documented text, a named point to compare the next documenting with.
    expect(p.schema.versions[0]!.dbml).toBe(p.schema.dbml);
    expect(p.connections[0]!.documentedAt).toBe(AT.toISOString());

    // Each source is checked against its table, and the rules the design says follow.
    expect(nodeOf(p, customers!.id).schemaCheck).toEqual({ schema: 'public', table: 'customers', mapping: {} });
    expect(nodeOf(p, orders!.id).schemaCheck).toEqual({ schema: 'public', table: 'orders', mapping: {} });
    const ruleLabels = (sourceId: string) => nodeOf(project(), sourceId).rules.filter((r) => r.fromSchema).map((r) => r.label);
    expect(ruleLabels(customers!.id)).toEqual(['id is unique', 'email is unique', 'id is never empty', 'id reads as INTEGER', 'name is never empty', 'signed_up reads as DATE', 'active reads as BOOLEAN']);
    expect(ruleLabels(orders!.id)).toContain('Every customer_id exists in customers.id');
    // The Relationships view sees the documented ref between the two sources, stated by the schema and by the derived rule.
    const rels = findRelationships(p, () => undefined);
    expect(rels.map((r) => [r.from.column, r.to.column, r.via.map((v) => v.kind).sort()])).toEqual([['customer_id', 'id', ['rule', 'schema']]]);

    // A source added afterwards is checked too; a query is not.
    const [totals, query] = addConnectionSources(c, { tables: [catalog.tables[2]!], query: 'SELECT 1' });
    expect(nodeOf(project(), totals!.id).schemaCheck).toEqual({ schema: 'public', table: 'order_totals', mapping: {} });
    expect(nodeOf(project(), query!.id).schemaCheck).toBeUndefined();
    expect(documentedCover(project().connections)).toBe('Documented from Shop (SQLite, read 2026-10-21)');
  });

  it('documenting again shows what changed, replaces the group and keeps the user’s own tables', async () => {
    const c = connect('sqlite');
    useProjectStore.getState().apply((p) => ({ ...p, schema: { ...p.schema, dbml: 'Table people {\n  id int [pk]\n}\n' } }));
    const detail = await readSchemaDetail(c);
    applyDocument(c, planDocument(project(), c, detail, AT), AT);
    const later = new Date('2026-10-22T09:00:00Z');
    const changed = { ...detail, tables: detail.tables.map((t) => (t.name === 'orders' ? { ...t, columns: [...t.columns, { name: 'note', type: 'TEXT', pk: false, unique: false, notNull: false, increment: false }] } : t)) };
    const plan = planDocument(project(), c, changed, later);
    expect(plan.diff!.changes.map((x) => x.text)).toEqual(['Added column "note" (TEXT)']);
    applyDocument(c, plan, later);
    const p = project();
    const schema = parseDbml(p.schema.dbml).schema;
    expect(schema.tables.map((t) => t.name)).toEqual(['people', 'customers', 'orders', 'order_totals']);
    expect(schema.groups).toHaveLength(1);
    expect(schema.groups[0]!.note).toBe('Documented from SQLite connection Shop on 2026-10-22');
    expect(p.schema.versions.map((v) => v.label)).toEqual(['Shop documented 2026-10-22', 'Shop documented 2026-10-21']);

    // Picking tables documents those alone.
    const some = planDocument(project(), c, changed, later, ['customers']);
    expect(some.generated.tables.map((t) => t.name)).toEqual(['customers']);
    expect(some.generated.refs).toEqual([]);
  });

  it('a DuckDB file documents its enum and index, and a source of it is checked', async () => {
    const c = connect('duckdb');
    const catalog = await readCatalog(c);
    const [orders] = addConnectionSources(c, { tables: [catalog.tables.find((t) => t.name === 'orders')!] });
    applyDocument(c, planDocument(project(), c, await readSchemaDetail(c), AT), AT);
    const p = checkDocumentedSources(project(), c);
    const schema = parseDbml(p.schema.dbml).schema;
    expect(schema.enums.map((e) => e.name)).toEqual(['order_status']);
    expect(schema.tables.find((t) => t.name === 'orders')!.indexes[0]!.name).toBe('orders_customer');
    expect(p.nodes.find((n) => n.type === 'source' && n.sourceId === orders!.id)!.schemaCheck).toEqual({ schema: 'public', table: 'orders', mapping: {} });
  });
});
