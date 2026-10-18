import { useSession } from '../app/session';
import { useNodeStatus } from '../flow/status';
import { useProject } from '../model';
import { QuickFixBar } from '../ui';
import { QUICK_FIXES, type FixContext } from './fixes';
import { addStepWhereViewed, detectOnViewed } from './place';

/** Add the fix's step where the viewed data is, then view and select it. */
async function runFix(id: string, option: string | undefined, ctx: FixContext) {
  const fix = QUICK_FIXES.find((f) => f.id === id);
  if (!fix) return;
  addStepWhereViewed(await fix.build(ctx, option));
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
    detectDates: detectOnViewed(viewed),
  };
  return (
    <div data-testid="quick-fixes" data-columns={columns.join(',')}>
      <QuickFixBar
        fixes={QUICK_FIXES.map((f) => ({ label: f.label, group: f.group, options: f.options }))}
        onFix={(fix, option) => void runFix(QUICK_FIXES.find((f) => f.label === fix.label)!.id, option, ctx)}
      />
    </div>
  );
}
