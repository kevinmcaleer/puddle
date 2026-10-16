import { appendColumns, appendProblems, type AppendInput } from '../compiler';
import { useFlowStore } from '../flow/status';
import { inputEdge, inputPorts, nodeById, renameNode, setAppendSpec, swapAppendInputs, useProject, useProjectStore, type AppendNode, type AppendSpec } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, columnKind, Field, Section, Select, Switch, TypeTag } from '../ui';

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);

const MATCH = [
  { value: 'name', label: 'By name' },
  { value: 'position', label: 'By position' },
];

/** "1, 2 and 4" */
const listOf = (ns: number[]) => (ns.length < 2 ? ns.join('') : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`);

/** The inspector for an Append node: its inputs in order, how columns line up, an optional source column, and where each column comes from. */
export function AppendPanel({ node }: { node: AppendNode }) {
  const project = useProject();
  const statuses = useFlowStore((s) => s.nodes);
  const spec = node.appendSpec;
  const update = (patch: Partial<AppendSpec>) => apply((p) => setAppendSpec(p, node.id, patch));

  // Every input but the spare one after the last wire; an empty one in the middle keeps its place.
  const ports = inputPorts(project, node).slice(0, -1);
  const slots = ports.map((port) => {
    const from = inputEdge(project, node.id, port.id)?.from.nodeId;
    const status = from ? statuses[from]?.status : undefined;
    return { n: Number(port.id), from: from ? nodeById(project, from) : undefined, columns: status?.state === 'ok' ? status.columns : undefined };
  });
  const wired = slots.filter((s) => s.from);
  const known = wired.every((s) => s.columns);
  const inputs: AppendInput[] = known ? wired.map((s) => ({ label: s.from!.name, columns: s.columns! })) : [];
  const problems = known && wired.length > 1 ? appendProblems(spec, inputs) : [];
  const clashes = problems.filter((p) => p.field !== 'tagColumn');
  const tagError = problems.find((p) => p.field === 'tagColumn')?.message;
  const columns = known && wired.length > 1 ? appendColumns(spec, inputs) : [];
  // Inputs are numbered on the node by port; map the stacked inputs back to those numbers.
  const number = (i: number) => wired[i]!.n + 1;

  return (
    <div data-testid="inspector-append">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
      </div>
      <Section title="Inputs" count={wired.length}>
        {slots.length ? (
          <ol className="flex flex-col gap-1" data-testid="append-inputs">
            {slots.map((s, i) => (
              <li key={s.n} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2">
                <span className="ui-metric">{s.n + 1}</span>
                <span className={s.from ? 'truncate text-ink' : 'truncate text-ink-muted'}>{s.from?.name ?? 'Not connected'}</span>
                <Button variant="ghost" size="sm" icon="chevron-up" iconOnly aria-label={`Move input ${s.n + 1} up`} disabled={i === 0} onClick={() => apply((p) => swapAppendInputs(p, node.id, s.n, slots[i - 1]!.n))} />
                <Button variant="ghost" size="sm" icon="chevron-down" iconOnly aria-label={`Move input ${s.n + 1} down`} disabled={i === slots.length - 1} onClick={() => apply((p) => swapAppendInputs(p, node.id, s.n, slots[i + 1]!.n))} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-muted">Connect two or more nodes into the numbered inputs. Rows stack in that order.</p>
        )}
      </Section>
      <Section title="Append">
        <div className="flex flex-col gap-3" data-testid="append-settings">
          <Field label="Match columns" htmlFor="append-match" hint={spec.match === 'name' ? 'Columns with the same name line up, in any order. A column an input lacks is left empty.' : 'The first column of each input lines up, then the second, and so on. Names come from the first input.'}>
            <Select id="append-match" options={MATCH} value={spec.match} onChange={(e) => update({ match: e.target.value as AppendSpec['match'] })} />
          </Field>
          <Switch id="append-tag" label="Add a column naming each row’s input" checked={spec.tagRows} onChange={(tagRows) => update({ tagRows })} />
          {spec.tagRows && (
            <Field label="Column name" htmlFor="append-tag-column" error={tagError}>
              <CommitInput key={spec.tagColumn} id="append-tag-column" mono error={!!tagError} value={spec.tagColumn} onCommit={(tagColumn) => update({ tagColumn })} />
            </Field>
          )}
          {clashes.map((p) => (
            <div key={p.message} data-testid="append-clash">
              <Banner tone="fail" title="These inputs don’t stack">
                {p.message}
              </Banner>
            </div>
          ))}
        </div>
      </Section>
      {columns.length > 0 && (
        <Section title="Where columns come from" count={columns.length}>
          <ul className="ui-schema" data-testid="append-columns">
            {columns.map((c) => (
              <li key={c.name}>
                <TypeTag type={columnKind(c.type)} />
                <span className="ui-col">{c.name}</span>
                <span className="ui-metric ml-auto" data-testid="append-column-from">
                  {c.from.length === wired.length ? 'all inputs' : `only ${c.from.length === 1 ? 'input' : 'inputs'} ${listOf(c.from.map(number))}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
