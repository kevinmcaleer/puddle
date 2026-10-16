import { useMemo } from 'react';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { compileDisplayPage, upstreamKey, type Condition } from '../compiler';
import { detectDateFormats, type Detection } from '../dates';
import { tableRows } from '../engine/client';
import { readPivotValues as readValues } from '../flow/pivot';
import { useNodeStatus } from '../flow/status';
import {
  addStep,
  canUngroup,
  moveStep,
  removeStep,
  renameNode,
  splitNode,
  ungroupNode,
  updateStep,
  useProject,
  useProjectStore,
  type ColumnSchema,
  type Project,
  type Step,
  type TransformNode,
} from '../model';
import { fieldErrors, labelFor, newStep, stepForms, type StepGroup } from '../steps';
import { CommitInput, StepForm } from '../steps/StepForm';
import { Banner, Button, Field, Menu, Section, StepList, Switch, type MenuItem } from '../ui';
import { useStepColumns, useStepErrors } from './useStepColumns';

const GROUPS: StepGroup[] = ['Clean', 'Columns', 'Rows', 'Text', 'Dates', 'Numbers', 'Reshape', 'Advanced'];

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);

/** Select a step: the inspector edits it and, unless the table is pinned, the results table shows the data after it. */
function viewStep(nodeId: string, index: number, step: Step | undefined) {
  useSession.getState().selectStep(step?.id ?? null);
  const { history, setView } = useProjectStore.getState();
  if (!history.present.view.pinned) setView({ viewedNodeId: nodeId, viewedStepIndex: step ? index : undefined });
}

/** The first row arriving after step `after` (-1 for the node's input), as text; empty when it can't be read. */
async function readFirstRow(project: Project, nodeId: string, after: number, columns: ColumnSchema[]): Promise<Record<string, string | null>> {
  const engine = useEngineStore.getState().engine;
  if (!engine || !columns.length) return {};
  try {
    const sql = compileDisplayPage(project, { nodeId, stepIndex: after }, columns.map((c) => c.name), 0, 1);
    const [row] = tableRows((await engine.query(sql)).table);
    return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, v == null ? null : String(v)]));
  } catch {
    return {};
  }
}

/** Date formats detected on the first of these columns as it arrives after step `after`. */
async function detectFor(project: Project, nodeId: string, after: number, columns: unknown): Promise<Detection | undefined> {
  const engine = useEngineStore.getState().engine;
  const column = Array.isArray(columns) && typeof columns[0] === 'string' ? columns[0] : undefined;
  if (!engine || !column) return undefined;
  return detectDateFormats(engine, project, { nodeId, stepIndex: after }, column).catch(() => undefined);
}

function AddStepMenu({ node, after }: { node: TransformNode; after: number }) {
  const project = useProject();
  const available = useStepColumns(project, node.id, after + 1);
  const items: MenuItem[] = GROUPS.flatMap((g) =>
    stepForms()
      .filter((f) => f.group === g)
      .map((f) => ({
        label: f.title,
        hint: g,
        onSelect: async () => {
          const selected = useSession.getState().selectedColumns;
          const firstRow = f.needsFirstRow ? await readFirstRow(project, node.id, after, available) : undefined;
          const dates = f.detectsDates ? await detectFor(project, node.id, after, f.defaults({ selected, available }).columns) : undefined;
          const step = newStep(f.type, { selected, available, firstRow, dates });
          apply((p) => addStep(p, node.id, step, after + 1));
          viewStep(node.id, after + 1, step);
        },
      })),
  );
  return <Menu label="Add step" button={{ variant: 'ghost', size: 'sm', icon: 'plus' }} items={items} />;
}

function StepSettings({ node, index, error }: { node: TransformNode; index: number; error?: string }) {
  const project = useProject();
  const step = node.steps[index]!;
  const columns = useStepColumns(project, node.id, index);
  const update = (patch: Partial<Step>) => apply((p) => updateStep(p, node.id, step.id, patch));
  // Detect on the step's input; a new function only when that input changes, so the form doesn't re-run it.
  const inputKey = upstreamKey(project, { nodeId: node.id, stepIndex: index - 1 });
  const detectDates = useMemo(
    () => {
      const engine = useEngineStore.getState().engine;
      const p = useProjectStore.getState().history.present;
      return engine ? (column: string) => detectDateFormats(engine, p, { nodeId: node.id, stepIndex: index - 1 }, column) : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputKey],
  );
  const readPivotValues = useMemo(
    () => {
      const engine = useEngineStore.getState().engine;
      const p = useProjectStore.getState().history.present;
      return engine ? (pivot: { column: string; filters: Condition[] }) => readValues(engine, p, { nodeId: node.id, stepIndex: index - 1 }, pivot) : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputKey],
  );
  return (
    <Section title="Step settings">
      <div className="flex flex-col gap-3" data-testid="step-settings">
        <Field label="Label" htmlFor="step-label" hint={step.customLabel ? 'Renamed. Clear it to follow the settings again.' : 'Follows the settings until you rename it.'}>
          <CommitInput
            key={step.label}
            id="step-label"
            value={step.label}
            onCommit={(v) => {
              const label = v.trim();
              update(label ? { label, customLabel: true } : { customLabel: false, label: labelFor({ ...step, customLabel: false }) });
            }}
          />
        </Field>
        <Switch id="step-enabled" label="Enabled" checked={step.enabled} onChange={(enabled) => update({ enabled })} />
        {/* Settings mistakes show on their fields; this is for what only running the step finds. */}
        {error && !Object.keys(fieldErrors(step)).length && (
          <Banner tone="fail" title="This step can’t run">
            {error}
          </Banner>
        )}
        <StepForm type={step.type} params={step.params} columns={columns} detectDates={detectDates} readPivotValues={readPivotValues} onChange={(params) => update({ params, label: labelFor({ ...step, params }) })} />
        <div className="flex flex-wrap gap-2">
          {index > 0 && (
            <Button size="sm" variant="ghost" icon="layout" onClick={() => apply((p) => splitNode(p, node.id, index))}>
              Split node here
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon="cross"
            onClick={() => {
              apply((p) => removeStep(p, node.id, step.id));
              viewStep(node.id, index - 1, node.steps[index - 1]);
            }}
          >
            Delete step
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** The inspector for a Transform node: header, applied steps, the selected step's settings. */
export function TransformPanel({ node }: { node: TransformNode }) {
  const project = useProject();
  const status = useNodeStatus(node.id);
  const selectedStepId = useSession((s) => s.selectedStepId);
  const selected = node.steps.findIndex((s) => s.id === selectedStepId);
  const viewed = project.view.viewedNodeId === node.id ? project.view.viewedStepIndex : undefined;
  const errors = useStepErrors(project, node.id, status.state === 'error', node.steps.length);

  return (
    <div data-testid="inspector-transform">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
        {canUngroup(node) && (
          <Button size="sm" variant="ghost" icon="layout" onClick={() => apply((p) => ungroupNode(p, node.id))}>
            Ungroup into the original nodes
          </Button>
        )}
      </div>
      <Section title="Applied steps" count={node.steps.length} action={<AddStepMenu node={node} after={selected >= 0 ? selected : node.steps.length - 1} />}>
        {node.steps.length ? (
          <StepList
            steps={node.steps.map((s, i) => ({ label: s.label, disabled: !s.enabled, error: errors[i] }))}
            selected={selected >= 0 ? selected : undefined}
            viewed={viewed}
            onSelect={(i) => viewStep(node.id, i, node.steps[i])}
            onMove={(from, to) => {
              apply((p) => moveStep(p, node.id, from, to));
              if (viewed != null) useProjectStore.getState().setView({ viewedStepIndex: to });
            }}
            onRemove={(i) => {
              apply((p) => removeStep(p, node.id, node.steps[i]!.id));
              viewStep(node.id, i - 1, node.steps[i - 1]);
            }}
            onAdd={false}
          />
        ) : (
          <p className="text-ink-muted">No steps yet. Add one, or select columns in the results table and use a quick fix.</p>
        )}
      </Section>
      {selected >= 0 && <StepSettings node={node} index={selected} error={errors[selected]} />}
    </div>
  );
}
