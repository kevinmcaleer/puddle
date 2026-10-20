import { useEffect, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { checkKeys } from '../flow/keys';
import { useFlowStore } from '../flow/status';
import type { Project } from '../model';
import { declaredKeys, findRelationships, keyColumns, relationshipTables, type ColumnsOf, type Relationship, type RelTable, type Uniqueness } from './model';

/** Which key columns repeat, checked in the background for every table whose columns are known. */
function useUniqueness(project: Project, tables: RelTable[], relationships: Relationship[]): Uniqueness {
  const engine = useEngineStore((s) => s.engine);
  const [unique, setUnique] = useState<Uniqueness>({});
  const keys = keyColumns(relationships);
  const ask = tables.flatMap((t) => (t.columns && keys.has(t.nodeId) ? [{ nodeId: t.nodeId, columns: keys.get(t.nodeId)!.filter((c) => t.columns!.some((x) => x.name === c)) }] : [])).filter((a) => a.columns.length);
  const signature = JSON.stringify(ask);
  useEffect(() => {
    if (!engine) return;
    let live = true;
    for (const a of ask)
      checkKeys(engine, project, a.nodeId, a.columns).then(
        (u) => live && setUnique((s) => ({ ...s, [a.nodeId]: { ...s[a.nodeId], ...u } })),
        () => undefined,
      );
    return () => {
      live = false;
    };
    // The project is read as it is when the asked-for columns change; a change upstream changes them or their status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, signature, project.nodes]);
  return unique;
}

/**
 * The project's relationships and their tables as they stand, with which key columns are one end or many: checked in
 * the background, and a Schema table's declared keys unique by design (its load is refused otherwise).
 */
export function useRelationships(project: Project): { columnsOf: ColumnsOf; relationships: Relationship[]; tables: RelTable[]; unique: Uniqueness } {
  const statuses = useFlowStore((s) => s.nodes);
  const columnsOf: ColumnsOf = (id) => {
    const s = statuses[id]?.status;
    return s?.state === 'ok' ? s.columns : undefined;
  };
  const relationships = findRelationships(project, columnsOf);
  const tables = relationshipTables(project, relationships, columnsOf);
  const checked = useUniqueness(project, tables, relationships);
  const declared = declaredKeys(project);
  const unique: Uniqueness = { ...checked };
  for (const [id, cols] of Object.entries(declared)) unique[id] = { ...checked[id], ...cols };
  return { columnsOf, relationships, tables, unique };
}
