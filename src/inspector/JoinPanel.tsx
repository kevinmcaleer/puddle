import { useEffect, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { JOIN_TYPES, joinProblems, keepsRightColumns, suggestJoinKey, textKeys, upstreamKey, type KeyTidy } from '../compiler';
import { checkJoin, checkJoinTidy, cureWords, joinCure, joinMatchRate, keptSide, multiplied, sideMatch, unmatchedFate, type Cure, type JoinCounts, type Multiplied } from '../flow/join';
import { useNodeStatus } from '../flow/status';
import { addBeforeJoin, addUnmatchedJoin, inputEdge, JOIN_KINDS, newId, nodeById, renameNode, setJoinSpec, swapJoinInputs, useProject, useProjectStore, type ColumnSchema, type JoinKey, type JoinKind, type JoinNode, type JoinSpec, type Step } from '../model';
import { viewNode } from '../results/pin';
import { newStep, relabel } from '../steps';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, Field, fullCount, Section, Select } from '../ui';

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);
const NONE: ColumnSchema[] = [];
const KINDS = JOIN_KINDS.map((k) => ({ value: k, label: JOIN_TYPES[k].label }));

/** The node wired into one side of a join, and the columns arriving from it once known. */
function useSide(node: JoinNode, port: 'left' | 'right') {
  const project = useProject();
  const fromId = inputEdge(project, node.id, port)?.from.nodeId;
  const status = useNodeStatus(fromId ?? '');
  return { from: fromId ? nodeById(project, fromId) : undefined, columns: fromId && status.state === 'ok' ? status.columns : undefined };
}

type Checked = { counts: JoinCounts; cure?: Cure };

/**
 * How the join matched, counted in the background once it runs: its rows and matches, and, when rows of its kept
 * side found no match, the tidy of its text keys that would match more of them. Undefined until known.
 */
function useJoinCheck(node: JoinNode): Checked | undefined {
  const project = useProject();
  const engine = useEngineStore((s) => s.engine);
  const ok = useNodeStatus(node.id).state === 'ok';
  const key = ok ? upstreamKey(project, { nodeId: node.id }) : '';
  const [found, setFound] = useState<{ key: string; value?: Checked } | null>(null);
  useEffect(() => {
    if (!engine || !key) return;
    let live = true;
    const present = useProjectStore.getState().history.present;
    const kind = node.joinSpec.kind;
    checkJoin(engine, present, node.id)
      .then(async (counts) => {
        if (live) setFound({ key, value: { counts } });
        if (!sideMatch(counts, keptSide(kind)).unmatched) return;
        const tidy = await checkJoinTidy(engine, present, node.id);
        const cure = tidy && joinCure(kind, counts, tidy);
        if (live && cure) setFound({ key, value: { counts, cure } });
      })
      .catch(() => live && setFound((f) => (f?.key === key ? f : { key })));
    return () => {
      live = false;
    };
    // `key` covers the join's settings and everything upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key]);
  return found?.key === key ? found.value : undefined;
}

/** The steps that tidy these key columns: trim, then capitals. */
function tidySteps(columns: string[], available: ColumnSchema[], tidy: KeyTidy): Step[] {
  const make = (type: string, extra: Record<string, unknown> = {}) => {
    const step = newStep(type, { selected: columns, available });
    return relabel({ ...step, params: { ...step.params, columns, ...extra } });
  };
  return [...(tidy.trim ? [make('trimWhitespace')] : []), ...(tidy.upper ? [make('changeCase', { mode: 'upper' })] : [])];
}

const plural = (n: number, what: string) => `${fullCount(n)} ${what}${n === 1 ? '' : 's'}`;

function MultipliedBanner({ spec, m }: { spec: JoinSpec; m: Multiplied }) {
  const other = m.side === 'left' ? 'right' : 'left';
  const keys = spec.keys.map((k) => k[other]).join(', ');
  return (
    <div data-testid="join-multiplied">
      <Banner tone="warn" title="This join adds rows">
        Some {m.side} rows match more than one {other} row, because {keys} {spec.keys.length === 1 ? 'isn’t' : 'aren’t'} unique on the {other}. {plural(m.before, 'row')} on the {m.side} became {plural(m.after, 'row')}.
      </Banner>
    </div>
  );
}

/** How each side matched, and for the kept side's rows with no match: what becomes of them, a way to see them and a cure. */
function MatchReport({ node, checked, left, right }: { node: JoinNode; checked: Checked; left: ColumnSchema[]; right: ColumnSchema[] }) {
  const spec = node.joinSpec;
  const { counts, cure } = checked;
  const side = keptSide(spec.kind);
  const { unmatched } = sideMatch(counts, side);
  const text = textKeys(spec, left, right);
  const show = () => {
    const id = newId('n');
    apply((p) => addUnmatchedJoin(p, node.id, id));
    if (!nodeById(useProjectStore.getState().history.present, id)) return;
    useSession.getState().select(id);
    viewNode(id);
  };
  const tidy = (t: KeyTidy) =>
    apply((p) =>
      addBeforeJoin(p, node.id, {
        left: tidySteps([...new Set(text.map((k) => k.left))], left, t),
        right: tidySteps([...new Set(text.map((k) => k.right))], right, t),
      }),
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink" data-testid="join-match">
        {joinMatchRate(counts, 'left')}. {joinMatchRate(counts, 'right')}.
      </p>
      {unmatched > 0 && (
        <div data-testid="join-unmatched">
          <Banner tone="info" title={`${plural(unmatched, `${side} row`)} found no match`}>
            {unmatchedFate(spec.kind)}
            {cure && (
              <span data-testid="join-cure">
                {' '}
                {cureWords(cure.tidy)} in {text.map((k) => (k.left === k.right ? k.left : `${k.left} and ${k.right}`)).join(', ')} on both sides would match {plural(cure.gained, 'more row')}.
              </span>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {cure && (
                <Button size="sm" variant="secondary" onClick={() => tidy(cure.tidy)}>
                  Tidy the keys
                </Button>
              )}
              {spec.kind !== 'anti' && (
                <Button size="sm" variant="ghost" onClick={show}>
                  Show them
                </Button>
              )}
            </div>
          </Banner>
        </div>
      )}
    </div>
  );
}

function KeyPairs({ spec, left, right, errors, onChange }: { spec: JoinSpec; left: ColumnSchema[]; right: ColumnSchema[]; errors: Record<number, string>; onChange: (keys: JoinKey[]) => void }) {
  const set = (i: number, patch: Partial<JoinKey>) => onChange(spec.keys.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const options = (value: string, columns: ColumnSchema[]) => [...new Set([value, ...columns.map((c) => c.name)])].map((v) => ({ value: v, label: v || 'Choose a column' }));
  const next = (): JoinKey =>
    suggestJoinKey(
      left,
      right,
      spec.keys.map((k) => k.left),
    ) ?? { left: left[0]?.name ?? '', right: right[0]?.name ?? '' };
  return (
    <div className="flex flex-col gap-2" data-testid="join-keys">
      {spec.keys.map((k, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
            <Select aria-label={`Left column ${i + 1}`} options={options(k.left, left)} value={k.left} onChange={(e) => set(i, { left: e.target.value })} />
            <span className="text-ink-muted">=</span>
            <Select aria-label={`Right column ${i + 1}`} options={options(k.right, right)} value={k.right} onChange={(e) => set(i, { right: e.target.value })} />
            <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove key ${i + 1}`} onClick={() => onChange(spec.keys.filter((_, j) => j !== i))} />
          </div>
          {errors[i] && <div className="ui-field__hint is-error">{errors[i]}</div>}
        </div>
      ))}
      <div>
        <Button variant="ghost" size="sm" icon="plus" onClick={() => onChange([...spec.keys, next()])}>
          Add key pair
        </Button>
      </div>
    </div>
  );
}

/** The inspector for a Join node: its inputs, join type, key pairs and suffix, and a warning when it adds rows. */
export function JoinPanel({ node }: { node: JoinNode }) {
  const spec = node.joinSpec;
  const left = useSide(node, 'left');
  const right = useSide(node, 'right');
  const checked = useJoinCheck(node);
  const m = checked && multiplied(spec.kind, checked.counts);
  const problems = joinProblems(spec, left.columns, right.columns);
  const keyErrors: Record<number, string> = {};
  for (const p of problems) if (p.key != null && !keyErrors[p.key]) keyErrors[p.key] = p.message;
  const fieldError = (f: 'keys' | 'suffix') => problems.find((p) => p.field === f)?.message;
  const update = (patch: Partial<JoinSpec>) => apply((p) => setJoinSpec(p, node.id, patch));

  return (
    <div data-testid="inspector-join">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
      </div>
      <Section
        title="Inputs"
        action={
          <Button size="sm" variant="ghost" disabled={!left.from && !right.from} onClick={() => apply((p) => swapJoinInputs(p, node.id))}>
            Swap inputs
          </Button>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="join-inputs">
          <dt className="text-ink-muted">Left</dt>
          <dd className="truncate text-ink">{left.from?.name ?? 'Not connected'}</dd>
          <dt className="text-ink-muted">Right</dt>
          <dd className="truncate text-ink">{right.from?.name ?? 'Not connected'}</dd>
        </dl>
      </Section>
      <Section title="Join">
        <div className="flex flex-col gap-3" data-testid="join-settings">
          <Field label="Join type" htmlFor="join-kind" hint={JOIN_TYPES[spec.kind].hint}>
            <Select id="join-kind" options={KINDS} value={spec.kind} onChange={(e) => update({ kind: e.target.value as JoinKind })} />
          </Field>
          <Field label="Match on" hint={spec.keys.length ? 'Rows match when every pair is equal.' : undefined} error={fieldError('keys')}>
            <KeyPairs spec={spec} left={left.columns ?? NONE} right={right.columns ?? NONE} errors={keyErrors} onChange={(keys) => update({ keys })} />
          </Field>
          {keepsRightColumns(spec.kind) && (
            <Field label="Suffix for clashing columns" htmlFor="join-suffix" hint="Added to a right column whose name the left side already has." error={fieldError('suffix')}>
              <CommitInput key={spec.suffix} id="join-suffix" mono error={!!fieldError('suffix')} value={spec.suffix} onCommit={(suffix) => update({ suffix })} />
            </Field>
          )}
          {checked && <MatchReport node={node} checked={checked} left={left.columns ?? NONE} right={right.columns ?? NONE} />}
          {m && <MultipliedBanner spec={spec} m={m} />}
        </div>
      </Section>
    </div>
  );
}
