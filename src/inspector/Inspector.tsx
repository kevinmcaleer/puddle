import { useState } from 'react';
import { useSession } from '../app/session';
import { useNodeStatus } from '../flow/status';
import { formatLabel } from '../canvas/formatLabel';
import { nodeById, setParseOptions, useProject, useProjectStore, type ParseOptions, type Source } from '../model';
import { Banner, columnKind, Field, Icon, NODE_KIND, Section, Select, StepList, Switch, TextInput, TypeTag } from '../ui';
import { DELIMITERS, delimiterValue, ENCODINGS, hasParseOptions, parseNullStrings, withOption } from './options';

/** A text input that commits on Enter or blur, so typing doesn't add an undo step per key. Key it by value to reset. */
function CommitInput({ id, value, onCommit, placeholder }: { id: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <TextInput
      id={id}
      mono
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

function SourceOptions({ source }: { source: Source }) {
  const apply = useProjectStore((s) => s.apply);
  const o = source.parseOptions;
  const set = <K extends keyof ParseOptions>(key: K, value: ParseOptions[K] | 'auto') => apply((p) => setParseOptions(p, source.id, withOption(o, key, value)));
  return (
    <Section title="Read options">
      <div className="flex flex-col gap-3">
        <Field label="Delimiter" htmlFor="opt-delimiter">
          <Select id="opt-delimiter" options={DELIMITERS} value={delimiterValue(source)} onChange={(e) => set('delimiter', e.target.value)} />
        </Field>
        <Switch id="opt-header" label="First row is the header" checked={o.header ?? true} onChange={(on) => set('header', on ? 'auto' : false)} />
        <Field label="Encoding" htmlFor="opt-encoding">
          <Select id="opt-encoding" options={ENCODINGS} value={o.encoding ?? 'utf-8'} onChange={(e) => set('encoding', e.target.value === 'utf-8' ? 'auto' : e.target.value)} />
        </Field>
        <Field label="Quote character" htmlFor="opt-quote" hint="Leave empty to detect it.">
          <CommitInput key={o.quote ?? ''} id="opt-quote" value={o.quote ?? ''} onCommit={(v) => set('quote', v)} placeholder='"' />
        </Field>
        <Field label="Treat as empty" htmlFor="opt-nulls" hint="Values read as empty, separated by commas.">
          <CommitInput key={(o.nullStrings ?? []).join(',')} id="opt-nulls" value={(o.nullStrings ?? []).join(', ')} onCommit={(v) => set('nullStrings', parseNullStrings(v))} placeholder="NA, n/a" />
        </Field>
      </div>
    </Section>
  );
}

function Columns({ nodeId }: { nodeId: string }) {
  const status = useNodeStatus(nodeId);
  if (status.state === 'error') return <div className="px-4 pb-4"><Banner tone="fail" title="This node can’t run">{status.message}</Banner></div>;
  if (status.state === 'unwired') return <div className="px-4 pb-4"><Banner tone="info">Connect a wire into this node to see its columns.</Banner></div>;
  if (status.state !== 'ok') return null;
  return (
    <Section title="Columns" count={status.columns.length}>
      <ul className="ui-schema" data-testid="inspector-columns">
        {status.columns.map((c) => (
          <li key={c.name}>
            <TypeTag type={columnKind(c.type)} />
            <span className="ui-col">{c.name}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The right-hand panel: what the selected node is, how it reads or transforms data, and its columns. */
export function Inspector() {
  const project = useProject();
  const selectedId = useSession((s) => s.selectedNodeId);
  const node = selectedId ? nodeById(project, selectedId) : undefined;

  if (!node)
    return (
      <Section title="Inspector">
        <p className="text-ink-muted">Select a node on the canvas to see its steps, settings and rules.</p>
      </Section>
    );

  const kind = NODE_KIND[node.type];
  const source = node.type === 'source' ? project.sources.find((s) => s.id === node.sourceId) : undefined;
  return (
    <div data-testid={`inspector-${node.type}`}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Icon name={kind.icon} />
        <div className="min-w-0">
          <div className="truncate text-body-strong text-ink" data-testid="inspector-name">{node.name}</div>
          <div className="text-label text-ink-muted">{source ? `${kind.label} · ${formatLabel(source.format)}` : kind.label}</div>
        </div>
      </div>
      {source && hasParseOptions(source) && <SourceOptions source={source} />}
      {node.type === 'transform' && (
        <Section title="Applied steps" count={node.steps.length}>
          {node.steps.length ? (
            <StepList steps={node.steps.map((s) => ({ label: s.label, disabled: !s.enabled }))} onAdd={false} />
          ) : (
            <p className="text-ink-muted">No steps yet. Steps arrive with the step editor.</p>
          )}
        </Section>
      )}
      <Columns nodeId={node.id} />
    </div>
  );
}
