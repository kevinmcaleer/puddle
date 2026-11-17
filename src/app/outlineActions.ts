// What the project panel does: open a row's node, make a query that reads a table by name, remove a node.
import { ident } from '../compiler';
import { addNode, nodeById, projectOutline, removeNodes, setQueriesInPanel, setSqlAndWires, useProjectStore } from '../model';
import { viewNode } from '../results/pin';
import { positionAfter } from './actions';
import { useSession } from './session';

/** A table's name as a query writes it: bare when DuckDB reads it as one word, quoted otherwise. */
export const sqlName = (name: string) => (/^[a-z_][a-z0-9_]*$/i.test(name) ? name : ident(name));

/** Select a node from the panel and show its rows, as a click on its card would. */
export function openFromPanel(nodeId: string) {
  useSession.getState().select(nodeId);
  viewNode(nodeId);
}

/**
 * A new query from the panel: a SQL node reading the selected table (or the project's first) by name, selected, shown
 * and asked for a name, since "SQL 3" says nothing about what it asks. One undo step. Says why when there is no table.
 */
export function addQueryFromPanel(): string | undefined {
  const { apply, history } = useProjectStore.getState();
  const session = useSession.getState();
  const tables = projectOutline(history.present).tables;
  const table = (tables.find((r) => r.node.id === session.selectedNodeId) ?? tables[0])?.node;
  if (!table) {
    session.notify({ tone: 'info', text: 'Add a table first: a query reads tables.' });
    return undefined;
  }
  let added: string | undefined;
  apply((p) => {
    const next = addNode(p, 'sql', positionAfter(p, [table.id]));
    added = next.nodes[next.nodes.length - 1]!.id;
    return setSqlAndWires(next, added, `SELECT *\nFROM ${sqlName(table.name)}`);
  });
  if (!added) return undefined;
  openFromPanel(added);
  useSession.getState().askRename(added);
  return added;
}

/** Remove a node from the panel, with its wires. */
export function removeFromPanel(nodeId: string) {
  const { apply, history } = useProjectStore.getState();
  if (!nodeById(history.present, nodeId)) return;
  apply((p) => removeNodes(p, [nodeId]));
  if (useSession.getState().selectedNodeId === nodeId) useSession.getState().select(null);
}

/** List the queries that end a flow in the panel only, or put them back on the canvas. */
export const moveQueriesToPanel = (on: boolean) => useProjectStore.getState().apply((p) => setQueriesInPanel(p, on));
