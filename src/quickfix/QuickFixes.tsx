import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { detectDateFormats } from '../dates';
import { useNodeStatus } from '../flow/status';
import { placeStep, useProject, useProjectStore } from '../model';
import { QuickFixBar } from '../ui';
import { QUICK_FIXES, type FixContext } from './fixes';

/** Add the fix's step where the viewed data is, then view and select it. */
async function runFix(id: string, option: string | undefined, ctx: FixContext) {
  const fix = QUICK_FIXES.find((f) => f.id === id);
  if (!fix) return;
  const step = await fix.build(ctx, option);
  const { apply, history, setView } = useProjectStore.getState();
  const placed = placeStep(history.present, step);
  if (!placed) return;
  apply(() => placed.project);
  setView({ viewedNodeId: placed.nodeId, viewedStepIndex: placed.stepIndex });
  useSession.getState().select(placed.nodeId);
  useSession.getState().selectStep(step.id);
}

/** The quick-fix chips over the results table, shown while columns are selected. */
export function QuickFixes() {
  const project = useProject();
  const columns = useSession((s) => s.selectedColumns);
  const viewed = project.view.viewedNodeId;
  const status = useNodeStatus(viewed ?? '');
  if (!viewed || !columns.length) return null;

  const ctx: FixContext = {
    columns,
    available: status.state === 'ok' ? status.columns : [],
    locale: project.settings.locale,
    detectDates: async (column) => {
      const engine = useEngineStore.getState().engine;
      const p = useProjectStore.getState().history.present;
      if (!engine) return undefined;
      return detectDateFormats(engine, p, { nodeId: viewed, stepIndex: p.view.viewedStepIndex }, column).catch(() => undefined);
    },
  };
  return (
    <div data-testid="quick-fixes" data-columns={columns.join(',')}>
      <QuickFixBar
        fixes={QUICK_FIXES.map((f) => ({ label: f.label, options: f.options }))}
        onFix={(fix, option) => void runFix(QUICK_FIXES.find((f) => f.label === fix.label)!.id, option, ctx)}
      />
    </div>
  );
}
