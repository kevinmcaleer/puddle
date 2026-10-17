import { positionAfter } from '../app/actions';
import { useSession } from '../app/session';
import { addNode, setSqlQuery, useProjectStore } from '../model';
import { viewNode } from '../results/pin';

/** Add a SQL node after the viewed node, wired to it and carrying the console's query; select and view it. One undo step. */
export function makeSqlNode(viewedId: string, query: string): string | undefined {
  let added: string | undefined;
  useProjectStore.getState().apply((p) => {
    const next = addNode(p, 'sql', positionAfter(p, [viewedId]), viewedId);
    added = next.nodes[next.nodes.length - 1]!.id;
    return setSqlQuery(next, added, query);
  });
  if (added) {
    useSession.getState().select(added);
    viewNode(added);
  }
  return added;
}
