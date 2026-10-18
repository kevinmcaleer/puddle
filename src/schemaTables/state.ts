// The project's schema as built in this tab's DuckDB: rebuilt whenever its DBML changes while the project has Schema
// table nodes, before the flow is evaluated, so those nodes read tables that exist.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { schemaDdlKey, tableFor, projectSchema } from '../compiler';
import { useProject, useProjectStore, type GraphNode, type Project } from '../model';
import { buildId, buildSchema, type Database, type SchemaBuild } from './build';
import type { NodeStatus } from '../flow/status';

interface SchemaTablesState {
  /** The DBML being built (its schemaDdlKey), or null when nothing is. */
  building: string | null;
  /** The last finished build. */
  built: SchemaBuild | null;
}

export const useSchemaTables = create<SchemaTablesState>(() => ({ building: null, built: null }));

/** DuckDB schemas made by the last build, so the next one drops them first. */
let made: string[] = [];
let queue: Promise<void> = Promise.resolve();

const hasTables = (project: Project) => project.nodes.some((n) => n.type === 'table');

/** Build the project's schema if it has table nodes and its DBML changed since the last build. */
export function syncSchemaTables(db: Database, project: Project): Promise<void> {
  if (!hasTables(project)) return queue;
  const key = schemaDdlKey(project.schema.dbml);
  const { building, built } = useSchemaTables.getState();
  if (building === key || (!building && built?.key === key)) return queue;
  useSchemaTables.setState({ building: key });
  queue = queue.then(async () => {
    // A later edit may have superseded this one while it waited.
    const now = useSchemaTables.getState();
    if (now.building !== key) return;
    const result = await buildSchema(db, project, made);
    made = result.schemas;
    const { schemas: _schemas, ...build } = result;
    if (useSchemaTables.getState().building === key) useSchemaTables.setState({ building: null, built: build });
  });
  return queue;
}

/** Forget every build (tests, and a fresh engine). */
export function resetSchemaTables() {
  made = [];
  queue = Promise.resolve();
  useSchemaTables.setState({ building: null, built: null });
}

/**
 * What a Schema table node's status is while its table isn't ready: pending while the schema builds, an error when its
 * table couldn't be built. Undefined when it is ready (or the node isn't a schema table), so the flow evaluates it.
 */
export function tableGate(project: Project, node: GraphNode, built: SchemaBuild | null = useSchemaTables.getState().built): NodeStatus | undefined {
  if (node.type !== 'table') return undefined;
  if (!node.tableSpec.table) return undefined;
  const key = schemaDdlKey(project.schema.dbml);
  if (built?.key !== key) return { state: 'pending' };
  try {
    tableFor(projectSchema(project.schema.dbml), node.tableSpec, node.name);
  } catch {
    // Compiling says what's wrong.
    return undefined;
  }
  const build = built.tables[buildId(node.tableSpec.schema, node.tableSpec.table)];
  return build?.state === 'failed' ? { state: 'error', message: build.message ?? `${node.tableSpec.table} can’t be built.` } : undefined;
}

/** The build notes for a node's table: what DuckDB couldn't be given as written. */
export function tableNotes(node: GraphNode, built: SchemaBuild | null): string[] {
  if (node.type !== 'table' || !built) return [];
  return built.tables[buildId(node.tableSpec.schema, node.tableSpec.table)]?.notes ?? [];
}

/** Keep the schema built while the editor is open. Runs before the flow is evaluated. */
export function useSchemaTableSync() {
  const engine = useEngineStore((s) => s.engine);
  const project = useProject();
  const dbml = project.schema.dbml;
  const tables = hasTables(project);
  useEffect(() => {
    if (engine && tables) void syncSchemaTables(engine, useProjectStore.getState().history.present);
  }, [engine, dbml, tables]);
}
