import { useEffect } from 'react';
import { useEngineStore } from '../app/engine';
import { updateSource, useProject, useProjectStore } from '../model';
import { useAttachments } from '../sources/attachments';
import { excelReady, useExcelReads } from '../sources/excel';
import { evaluateRules } from './rules';
import { evaluateFlow, useFlowStore } from './status';

/**
 * Keep node statuses in step with the project: re-evaluate whenever it changes, and record each source's
 * detected schema (a derived fact, so it doesn't add an undo step).
 */
export function useFlowEvaluation() {
  const project = useProject();
  const engine = useEngineStore((s) => s.engine);
  const attachments = useAttachments((s) => s.sources);
  // An Excel sheet being read (or that can't be) is not readable yet, like a file not chosen again.
  const excel = useExcelReads((s) => s.reads);

  useEffect(() => {
    if (!engine) return;
    void evaluateFlow(engine, project, (id) => (attachments[id] ?? 'detached') === 'detached' || !excelReady(project, id)).then(() => {
      // Rules run after every preview is settled, at background priority, so they never hold it up.
      void evaluateRules(engine, project);
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
  }, [engine, project, attachments, excel]);
}
