import { useEffect, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { lookupColumns, lookupProblems, suggestJoinKey, upstreamKey } from '../compiler';
import { checkLookup, matchRate, type LookupCounts } from '../flow/lookup';
import { useNodeStatus } from '../flow/status';
import { inputEdge, nodeById, renameNode, setLookupSpec, swapLookupInputs, useProject, useProjectStore, type ColumnSchema, type LookupKey, type LookupNode, type LookupSpec } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, columnKind, FieldChip, Field, Section, Select, Switch } from '../ui';

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);
const NONE: ColumnSchema[] = [];

/** The node wired into one input of a lookup, and the columns arriving from it once known. */
function useInput(node: LookupNode, port: 'main' | 'lookup') {
  const project = useProject();
  const fromId = inputEdge(project, node.id, port)?.from.nodeId;
  const status = useNodeStatus(fromId ?? '');
  return { from: fromId ? nodeById(project, fromId) : undefined, columns: fromId && status.state === 'ok' ? status.columns : undefined };
}

/** How the lookup matched, counted in the background once it runs; undefined until known. */
function useCounts(node: LookupNode): LookupCounts | undefined {
  const project = useProject();
  const engine = useEngineStore((s) => s.engine);
  const ok = useNodeStatus(node.id).state === 'ok';
  const key = ok ? upstreamKey(project, { nodeId: node.id }) : '';
  const [found, setFound] = useState<{ key: string; value?: LookupCounts } | null>(null);
  useEffect(() => {
    if (!engine || !key) return;
    let live = true;
    checkLookup(engine, useProjectStore.getState().history.present, node.id).then(
      (value) => live && setFound({ key, value }),
      () => live && setFound({ key }),
    );
    return () => {
      live = false;
    };
    // `key` covers the lookup's settings and everything upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key]);
  return found?.key === key ? found.value : undefined;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The match rate, then what happened to keys with several matches and keys with none. */
function MatchReport({ counts, spec }: { counts: LookupCounts; spec: LookupSpec }) {
  const unmatched = counts.rows - counts.matched;
  const filled = spec.useDefault ? `filled with “${spec.defaultValue}”` : 'left empty';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink" data-testid="lookup-match">
        {matchRate(counts)}
      </p>
      {counts.dupKeys > 0 && (
        <div data-testid="lookup-duplicates">
          <Banner tone="info" title={`${plural(counts.dupKeys, 'key')} ${counts.dupKeys === 1 ? 'matches' : 'match'} more than one lookup row`}>
            {counts.dupExample != null && <>For example {counts.dupExample}. </>}
            {plural(counts.dupRows, 'main row')} took the first match in file order, so the lookup still has {plural(counts.rows, 'row')}.
          </Banner>
        </div>
      )}
      {unmatched > 0 && (
        <div data-testid="lookup-missing">
          <Banner tone="info" title={`${plural(counts.missingKeys, 'key')} ${counts.missingKeys === 1 ? 'has' : 'have'} no match`}>
            {counts.missingExample != null && <>For example {counts.missingExample}. </>}
            The new columns of {plural(unmatched, 'row')} are {filled}.
          </Banner>
        </div>
      )}
    </div>
  );
}

function KeyPairs({ spec, main, lookup, errors, onChange }: { spec: LookupSpec; main: ColumnSchema[]; lookup: ColumnSchema[]; errors: Record<number, string>; onChange: (keys: LookupKey[]) => void }) {
  const set = (i: number, patch: Partial<LookupKey>) => onChange(spec.keys.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const options = (value: string, columns: ColumnSchema[]) => [...new Set([value, ...columns.map((c) => c.name)])].map((v) => ({ value: v, label: v || 'Choose a column' }));
  const next = (): LookupKey => {
    const k = suggestJoinKey(
      main,
      lookup,
      spec.keys.map((x) => x.main),
    );
    return k ? { main: k.left, lookup: k.right } : { main: main[0]?.name ?? '', lookup: lookup[0]?.name ?? '' };
  };
  return (
    <div className="flex flex-col gap-2" data-testid="lookup-keys">
      {spec.keys.map((k, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
            <Select aria-label={`Main column ${i + 1}`} options={options(k.main, main)} value={k.main} onChange={(e) => set(i, { main: e.target.value })} />
            <span className="text-ink-muted">=</span>
            <Select aria-label={`Lookup column ${i + 1}`} options={options(k.lookup, lookup)} value={k.lookup} onChange={(e) => set(i, { lookup: e.target.value })} />
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

/** The columns brought across, as chips that can be removed, and a menu of the lookup's other columns to add. */
function BroughtColumns({ spec, main, lookup, onChange }: { spec: LookupSpec; main: ColumnSchema[]; lookup: ColumnSchema[]; onChange: (columns: string[]) => void }) {
  const renamed = new Map(lookupColumns(spec, main).map((c) => [c.from, c.name]));
  const rest = lookup.filter((c) => !spec.columns.includes(c.name));
  return (
    <div className="flex flex-col gap-2">
      {spec.columns.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="lookup-columns">
          {spec.columns.map((name) => {
            const type = lookup.find((c) => c.name === name)?.type;
            const as = renamed.get(name);
            return <FieldChip key={name} name={name} type={type ? columnKind(type) : undefined} agg={as && as !== name ? `as ${as}` : undefined} onRemove={() => onChange(spec.columns.filter((c) => c !== name))} />;
          })}
        </div>
      )}
      {rest.length > 0 && (
        <Select
          aria-label="Add a column to bring across"
          options={[{ value: '', label: 'Add a column…' }, ...rest.map((c) => ({ value: c.name, label: c.name }))]}
          value=""
          onChange={(e) => e.target.value && onChange([...spec.columns, e.target.value])}
        />
      )}
    </div>
  );
}

/** The inspector for a Lookup node: its inputs, key pairs, the columns brought across, a default for unmatched keys, and how well it matched. */
export function LookupPanel({ node }: { node: LookupNode }) {
  const spec = node.lookupSpec;
  const main = useInput(node, 'main');
  const lookup = useInput(node, 'lookup');
  const counts = useCounts(node);
  const problems = lookupProblems(spec, main.columns, lookup.columns);
  const keyErrors: Record<number, string> = {};
  for (const p of problems) if (p.key != null && !keyErrors[p.key]) keyErrors[p.key] = p.message;
  const fieldError = (f: 'keys' | 'columns' | 'suffix' | 'defaultValue') => problems.find((p) => p.field === f)?.message;
  const update = (patch: Partial<LookupSpec>) => apply((p) => setLookupSpec(p, node.id, patch));
  const clashes = main.columns ? spec.columns.some((name) => main.columns!.some((c) => c.name === name)) : false;

  return (
    <div data-testid="inspector-lookup">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
      </div>
      <Section
        title="Inputs"
        action={
          <Button size="sm" variant="ghost" disabled={!main.from && !lookup.from} onClick={() => apply((p) => swapLookupInputs(p, node.id))}>
            Swap inputs
          </Button>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="lookup-inputs">
          <dt className="text-ink-muted">Main</dt>
          <dd className="truncate text-ink">{main.from?.name ?? 'Not connected'}</dd>
          <dt className="text-ink-muted">Lookup</dt>
          <dd className="truncate text-ink">{lookup.from?.name ?? 'Not connected'}</dd>
        </dl>
      </Section>
      <Section title="Lookup">
        <div className="flex flex-col gap-3" data-testid="lookup-settings">
          <Field label="Match on" hint={spec.keys.length ? 'A main row matches when every pair is equal. It takes the first matching lookup row, so no rows are added.' : undefined} error={fieldError('keys')}>
            <KeyPairs spec={spec} main={main.columns ?? NONE} lookup={lookup.columns ?? NONE} errors={keyErrors} onChange={(keys) => update({ keys })} />
          </Field>
          <Field label="Bring across" error={fieldError('columns')}>
            <BroughtColumns spec={spec} main={main.columns ?? NONE} lookup={lookup.columns ?? NONE} onChange={(columns) => update({ columns })} />
          </Field>
          {clashes && (
            <Field label="Suffix for clashing columns" htmlFor="lookup-suffix" hint="Added to a brought column whose name the main input already has." error={fieldError('suffix')}>
              <CommitInput key={spec.suffix} id="lookup-suffix" mono error={!!fieldError('suffix')} value={spec.suffix} onCommit={(suffix) => update({ suffix })} />
            </Field>
          )}
          <Switch id="lookup-use-default" label="Fill unmatched rows with a default" checked={spec.useDefault} onChange={(useDefault) => update({ useDefault })} />
          {spec.useDefault && (
            <Field label="Default value" htmlFor="lookup-default" hint="Written into the brought columns of a row whose key has no match." error={fieldError('defaultValue')}>
              <CommitInput key={spec.defaultValue} id="lookup-default" error={!!fieldError('defaultValue')} value={spec.defaultValue} onCommit={(defaultValue) => update({ defaultValue })} />
            </Field>
          )}
          {counts && <MatchReport counts={counts} spec={spec} />}
        </div>
      </Section>
    </div>
  );
}
