import { useSession } from '../app/session';
import { dismissFindings, useProject, useProjectStore, type GraphNode } from '../model';
import { Banner, Button } from '../ui';
import { FixAll } from './FixAll';
import { findingsHeadline } from './headline';
import { nodeIssues, useAnalysisEntry } from './state';

/** Whether the headline shows for a node: the results bar then leaves its own Fix all out. */
function useFindingsHeadline(node: GraphNode) {
  const project = useProject();
  const entry = useAnalysisEntry(node.id);
  if (entry?.state !== 'ok') return null;
  return findingsHeadline(node, nodeIssues(project, node, entry).open, project.settings.fixAllSuggestions);
}

/**
 * What was found in a source, above its rows: the count, Fix all, and Show me, which opens the Issues list. It goes
 * once the problems are fixed, or when it is dismissed, for good on that node.
 */
export function FindingsHeadline({ node }: { node: GraphNode }) {
  const headline = useFindingsHeadline(node);
  if (!headline) return null;
  return (
    <div className="px-3 pb-2" data-testid="findings-headline">
      <Banner
        tone="warn"
        title={<span data-testid="findings-title">{headline.text}</span>}
        action={
          <div className="flex items-center gap-2">
            <FixAll node={node} />
            <Button size="sm" variant="secondary" onClick={() => useSession.getState().showIssues(node.id)}>
              Show me
            </Button>
            <Button size="sm" variant="ghost" icon="cross" iconOnly aria-label="Dismiss" title="Dismiss: the Issues list keeps them" onClick={() => useProjectStore.getState().apply((p) => dismissFindings(p, node.id))} />
          </div>
        }
      >
        Each is put right by a step you can see, change and undo.
      </Banner>
    </div>
  );
}

/** The results bar's own Fix all: left out while the headline above it carries the button. */
export function BarFixAll({ node, headlineShown }: { node: GraphNode; headlineShown: boolean }) {
  const headline = useFindingsHeadline(node);
  return headline && headlineShown ? null : <FixAll node={node} />;
}
