import { positionAfter } from '../app/actions';
import { useSession } from '../app/session';
import { scriptTables } from '../compiler';
import { addNode, setSqlAndWires, syncScriptTables, useProjectStore } from '../model';
import { viewNode } from '../results/pin';

/**
 * Add a SQL node after the viewed node, wired to it and carrying the console's query; select and view it. Each table
 * the query creates (CREATE TABLE name AS ...) gets a node of its own after it. One undo step.
 */
export function makeSqlNode(viewedId: string, query: string): string | undefined {
  let added: string | undefined;
  useProjectStore.getState().apply((p) => {
    const next = addNode(p, 'sql', positionAfter(p, [viewedId]), viewedId);
    added = next.nodes[next.nodes.length - 1]!.id;
    return syncScriptTables(setSqlAndWires(next, added, query), added, [], scriptTables(query));
  });
  if (added) {
    useSession.getState().select(added);
    viewNode(added);
  }
  return added;
}
