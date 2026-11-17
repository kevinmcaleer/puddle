import { setNodeDescription, useProjectStore, type GraphNode } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Field } from '../ui';

/**
 * A node's description, under its name in the inspector: what the node is for, in a few words, shown on its card.
 * The same words as the canvas edits in place (canvas/Description.tsx).
 */
export function NodeDescription({ node }: { node: GraphNode }) {
  return (
    <Field label="Description" htmlFor="node-description" hint="What this node is for, in a few words. Shown on its card.">
      <CommitInput
        key={node.description ?? ''}
        id="node-description"
        value={node.description ?? ''}
        placeholder="e.g. combine into a single list"
        onCommit={(v) => useProjectStore.getState().apply((p) => setNodeDescription(p, node.id, v))}
      />
    </Field>
  );
}
