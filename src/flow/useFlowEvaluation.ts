import { useEffect } from 'react';
import { useEngineStore } from '../app/engine';
import { updateSource, useProject, useProjectStore } from '../model';
import { useAttachments } from '../sources/attachments';
import { evaluateFlow, useFlowStore } from './status';

/**
 * Keep node statuses in step with the project: re-evaluate whenever it changes, and record each source's
 * detected schema (a derived fact, so it doesn't add an undo step).
 */
export function useFlowEvaluation() {
  const project = useProject();
  const engine = useEngineStore((s) => s.engine);
  const attachments = useAttachments((s) => s.sources);

  useEffect(() => {
    if (!engine) return;
    void evaluateFlow(engine, project, (id) => (attachments[id] ?? 'detached') === 'detached').then(() => {
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
  }, [engine, project, attachments]);
}
