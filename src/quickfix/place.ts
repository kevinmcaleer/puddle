// Adding a step from the results table where the viewed data is, shared by the quick-fix bar and the column menu.
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { detectDateFormats } from '../dates';
import { readPivotValues } from '../flow/pivot';
import { placeStep, useProjectStore, type Step } from '../model';
import type { ColumnMenuContext } from './columnMenu';
import type { FixContext } from './fixes';

/** Add a step where the viewed data is (see placeStep), then view it and select it in the inspector. */
export function addStepWhereViewed(step: Step) {
  const { apply, history, setView } = useProjectStore.getState();
  const placed = placeStep(history.present, step);
  if (!placed) return;
  apply(() => placed.project);
  setView({ viewedNodeId: placed.nodeId, viewedStepIndex: placed.stepIndex });
  useSession.getState().select(placed.nodeId);
  useSession.getState().selectStep(step.id);
}

/** Detect date formats on a column of the viewed node's data, at the viewed step. */
export const detectOnViewed =
  (viewed: string): FixContext['detectDates'] =>
  async (column) => {
    const engine = useEngineStore.getState().engine;
    const p = useProjectStore.getState().history.present;
    if (!engine) return undefined;
    return detectDateFormats(engine, p, { nodeId: viewed, stepIndex: p.view.viewedStepIndex }, column).catch(() => undefined);
  };

/** Read the values a column of the viewed data would turn into columns, for a pivot added there. */
export const readOnViewed =
  (viewed: string): NonNullable<ColumnMenuContext['readPivotValues']> =>
  async (column) => {
    const engine = useEngineStore.getState().engine;
    const p = useProjectStore.getState().history.present;
    if (!engine) return undefined;
    return readPivotValues(engine, p, { nodeId: viewed, stepIndex: p.view.viewedStepIndex }, { column, filters: [] });
  };
