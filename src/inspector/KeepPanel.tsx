import { useMemo, useState } from 'react';
import { upstreamKey } from '../compiler';
import { useViewProject } from '../flow/sample';
import { keptNearLimit, keptView, useKeptEntry, useKeptStore, useKeptTotal } from '../flow/kept';
import { setKeepResult, useProjectStore, type GraphNode } from '../model';
import { Banner, Button, formatBytes, Section, Switch } from '../ui';

/**
 * "Keep result in memory": the node's output is held as a table, so previews downstream don't re-run
 * everything before it. Shows the memory it takes, and asks first when kept results already use a lot.
 */
export function KeepPanel({ node }: { node: GraphNode }) {
  const apply = useProjectStore((s) => s.apply);
  const entry = useKeptEntry(node.id);
  const total = useKeptTotal();
  const limit = useKeptStore((s) => s.limit);
  const [asking, setAsking] = useState(false);
  const on = !!node.pinnedResult;
  // Kept tables are built from the project as evaluated: the sampled copy in sample mode.
  const evaluated = useViewProject();
  const key = useMemo(() => (on ? upstreamKey(evaluated, { nodeId: node.id }) : null), [on, evaluated, node.id]);
  const view = key != null ? keptView(entry, key) : null;

  const keep = (value: boolean) => {
    setAsking(false);
    apply((p) => setKeepResult(p, node.id, value));
  };
  const toggle = (value: boolean) => (value && keptNearLimit(total, limit) ? setAsking(true) : keep(value));

  return (
    <Section title="Keep result">
      <div className="flex flex-col gap-2" data-testid="keep-result">
        <Switch id="keep-result" label="Keep result in memory" checked={on} onChange={toggle} />
        {view ? (
          <div className="ui-metric" data-testid="keep-memory" data-state={view.state}>
            {view.state === 'ready' ? `Uses ${formatBytes(view.bytes)}` : view.state === 'failed' ? `Couldn’t keep it: ${view.message}` : view.state === 'stopped' ? 'Stopped. Use Run again to build it.' : entry?.building ? 'Out of date. Rebuilding…' : 'Out of date. It rebuilds once this node runs.'}
          </div>
        ) : (
          <p className="text-label text-ink-muted">Nodes after this one read its result instead of re-running everything before it.</p>
        )}
        {asking && limit != null && (
          <Banner
            tone="warn"
            title="Memory is filling up"
            action={
              <Button size="sm" onClick={() => keep(true)}>
                Keep anyway
              </Button>
            }
          >
            Kept results already use {formatBytes(total)} of the engine’s {formatBytes(limit)}. Keeping another may leave too little for previews and exports.
          </Banner>
        )}
      </div>
    </Section>
  );
}
