import { setNodeNotes, useProjectStore, type GraphNode } from '../model';
import { Section } from '../ui';

const PLACEHOLDER: Record<GraphNode['type'], string> = {
  source: 'Where this file comes from, who sends it.',
  transform: 'Why this node exists, what it expects.',
  join: 'What the two tables are and why they match on these keys.',
  append: 'What the stacked tables have in common.',
  lookup: 'What is looked up, and why these keys find it.',
  output: 'Who uses this export, and where it goes.',
};

/** A short note on any node, saved when the field loses focus. The canvas marks nodes that have one. */
export function NodeNotes({ node }: { node: GraphNode }) {
  const apply = useProjectStore((s) => s.apply);
  return (
    <Section title="Notes">
      <textarea
        key={node.notes ?? ''}
        aria-label="Node notes"
        className="ui-input min-h-[var(--size-row)] w-full resize-y py-1"
        rows={3}
        defaultValue={node.notes ?? ''}
        placeholder={PLACEHOLDER[node.type]}
        onBlur={(e) => e.target.value !== (node.notes ?? '') && apply((p) => setNodeNotes(p, node.id, e.target.value))}
      />
    </Section>
  );
}
