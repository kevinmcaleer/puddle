// What the query designer draws: each wired input of a Query node as a table, with its columns once they're known.
import { create } from 'zustand';
import type { NodeStatus } from '../flow/status';
import { downstreamIds, hasOutput, inputEdges, nodeById, type ColumnSchema, type GraphNode, type Project, type QueryFieldRef, type QueryNode } from '../model';

export interface DesignerTable {
  port: number;
  fromId: string;
  /** The feeding node's name. */
  label: string;
  /** Undefined while they're being read, or when the feeding node can't run. */
  columns?: ColumnSchema[];
  /** Why the columns aren't known, when the feeding node can't run. */
  problem?: string;
  x: number;
  y: number;
}

/** Spacing for tables that have no place in the designer yet: side by side, a node's width plus a gap apart. */
export const TABLE_SPACING = 264;
export const TABLE_MARGIN = 24;

/** The Query's tables in input order, placed where they were last moved to (or side by side). */
export function designerTables(project: Project, node: QueryNode, statuses: Record<string, { status: NodeStatus } | undefined>): DesignerTable[] {
  return inputEdges(project, node.id)
    .filter((e) => typeof e.to.port === 'number')
    .map((e, i) => {
      const port = e.to.port as number;
      const from = nodeById(project, e.from.nodeId);
      const status = statuses[e.from.nodeId]?.status;
      const at = node.querySpec.tables.find((t) => t.port === port) ?? { x: TABLE_MARGIN + i * TABLE_SPACING, y: TABLE_MARGIN };
      return {
        port,
        fromId: e.from.nodeId,
        label: from?.name ?? e.from.nodeId,
        columns: status?.state === 'ok' ? status.columns : undefined,
        problem: status?.state === 'error' ? status.message : status?.state === 'unwired' ? `${from?.name ?? 'This node'} isn’t connected to anything yet.` : undefined,
        x: at.x,
        y: at.y,
      };
    });
}

/** Nodes that can be added to the query as a table: any with an output that isn't the query or fed by it. */
export function tableCandidates(project: Project, nodeId: string): GraphNode[] {
  const below = downstreamIds(project, nodeId);
  return project.nodes.filter((n) => hasOutput(n) && !below.has(n.id));
}

/** A field as a key for lookups: "0:customer_id". */
export const refKey = (ref: QueryFieldRef) => `${ref.port}:${ref.column}`;

/** The designer's own state: which join line is selected (the inspector shows it too). */
export const useDesigner = create<{ selectedJoinId: string | null; selectJoin: (id: string | null) => void }>((set) => ({
  selectedJoinId: null,
  selectJoin: (selectedJoinId) => set({ selectedJoinId }),
}));
