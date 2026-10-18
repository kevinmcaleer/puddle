import { useEffect } from 'react';
import { useEngineStore } from '../app/engine';
import { updateSource, useProject, useProjectStore, type Project } from '../model';
import { useAttachments, type Attachment } from '../sources/attachments';
import { excelReady, useExcelReads } from '../sources/excel';
import { useXmlReads, xmlReady } from '../sources/xml';
import { syncKept } from './kept';
import { useRerun } from './rerun';
import { evaluateRules } from './rules';
import { countSources, useViewProject } from './sample';
import { evaluateFlow, useFlowStore } from './status';

/**
 * A source that can't be read in this tab: its file isn't chosen again, or it is an Excel sheet or XML not read (yet) for
 * its current options. The sampled copy of a project has the same sources and options, so either copy will do.
 */
const unreadable = (attachments: Record<string, Attachment>, project: Project, id: string) => (attachments[id] ?? 'detached') === 'detached' || !excelReady(project, id) || !xmlReady(project, id);

/**
 * Keep node statuses in step with the project: re-evaluate whenever it changes, bring kept results up to
 * date, and record each source's detected schema (a derived fact, so it doesn't add an undo step).
 */
export function useFlowEvaluation() {
  const project = useProject();
  // In sample mode, previews and rules read the sampled copy; source counts always read the full data.
  const view = useViewProject();
  const engine = useEngineStore((s) => s.engine);
  const attachments = useAttachments((s) => s.sources);
  // An Excel sheet being read (or that can't be) is not readable yet, like a file not chosen again.
  const excel = useExcelReads((s) => s.reads);
  const xml = useXmlReads((s) => s.reads);
  const tick = useRerun((s) => s.tick);

  useEffect(() => {
    if (!engine) return;
    void countSources(engine, project, (id) => !unreadable(attachments, project, id));
  }, [engine, project, attachments, excel, xml, tick]);

  useEffect(() => {
    if (!engine) return;
    void evaluateFlow(engine, view, (id) => unreadable(attachments, view, id)).then(() => {
      // Rules run after every preview is settled, at background priority, so they never hold it up.
      void evaluateRules(engine, view);
      // Kept results build behind them too, from the project as evaluated (the sampled copy in sample mode),
      // and only once their node is known to work.
      void syncKept(engine, view);
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
  }, [engine, view, attachments, excel, xml, tick]);
}
