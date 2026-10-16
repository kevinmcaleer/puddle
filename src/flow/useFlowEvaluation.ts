import { useEffect } from 'react';
import { useEngineStore } from '../app/engine';
import { updateSource, useProject, useProjectStore } from '../model';
import { useAttachments } from '../sources/attachments';
import { useRerun } from './rerun';
import { evaluateRules } from './rules';
import { countSources, useViewProject } from './sample';
import { evaluateFlow, useFlowStore } from './status';

/**
 * Keep node statuses in step with the project: re-evaluate whenever it changes, and record each source's
 * detected schema (a derived fact, so it doesn't add an undo step).
 */
export function useFlowEvaluation() {
  const project = useProject();
  // In sample mode, previews and rules read the sampled copy; source counts always read the full data.
  const view = useViewProject();
  const engine = useEngineStore((s) => s.engine);
  const attachments = useAttachments((s) => s.sources);
  const tick = useRerun((s) => s.tick);

  useEffect(() => {
    if (!engine) return;
    const detached = (id: string) => (attachments[id] ?? 'detached') === 'detached';
    void countSources(engine, project, (id) => !detached(id));
  }, [engine, project, attachments, tick]);

  useEffect(() => {
    if (!engine) return;
    void evaluateFlow(engine, view, (id) => (attachments[id] ?? 'detached') === 'detached').then(() => {
      // Rules run after every preview is settled, at background priority, so they never hold it up.
      void evaluateRules(engine, view);
      const statuses = useFlowStore.getState().nodes;
      useProjectStore.getState().amend((p) => {
        let next = p;
        for (const n of p.nodes) {
          if (n.type !== 'source') continue;
          const st = statuses[n.id]?.status;
          const source = p.sources.find((s) => s.id === n.sourceId);
          if (st?.state !== 'ok' || !source) continue;
          if (JSON.stringify(source.detectedSchema) !== JSON.stringify(st.columns)) next = updateSource(next, source.id, { detectedSchema: st.columns });
        }
        return next;
      });
    });
  }, [engine, view, attachments, tick]);
}
