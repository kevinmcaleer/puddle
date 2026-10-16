import { useSession } from '../app/session';
import { useNodeStatus } from '../flow/status';
import { formatLabel } from '../canvas/formatLabel';
import { nodeById, setParseOptions, useProject, useProjectStore, type ParseOptions, type ProjectSettings as ProjectSettingsT, type Source } from '../model';
import { Banner, columnKind, Field, Icon, NODE_KIND, Section, Select, Switch, TypeTag } from '../ui';
import { CommitInput } from '../steps/StepForm';
import { NodeNotes } from './NodeNotes';
import { OutputPanel } from './OutputPanel';
import { RulesPanel } from './RulesPanel';
import { TransformPanel } from './TransformPanel';
import { useAttachments } from '../sources/attachments';
import { detachedMessage } from '../sources/attach';
import { ReattachButton } from '../sources/ReattachButton';
import { UrlPanel } from '../sources/UrlPanel';
import { DELIMITERS, delimiterValue, ENCODINGS, hasParseOptions, LOCALES, parseNullStrings, withOption } from './options';

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

/** A warning on a source whose file needs choosing again, or turned out different from the one it was built on. */
function AttachmentBanner({ source }: { source: Source }) {
  const state = useAttachments((s) => s.sources[source.id] ?? 'detached');
  if (state === 'attached') return null;
  return (
    <div className="px-4 pt-3" data-testid="attachment-banner" data-state={state}>
      {state === 'detached' ? (
        <Banner tone="warn" title="File not connected" action={<ReattachButton source={source} />}>
          {detachedMessage(source)}
        </Banner>
      ) : (
        <Banner tone="warn" title="This file looks different" action={<ReattachButton source={source} label="Choose another" />}>
          Its first megabyte doesn’t match the file this project was built on. The steps have re-run on it; check the results.
        </Banner>
      )}
    </div>
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

/** Settings for the whole project: when to sample, and how dates and numbers are read and shown. */
function ProjectSettings() {
  const settings = useProject().settings;
  const apply = useProjectStore((s) => s.apply);
  const set = (patch: Partial<ProjectSettingsT>) => apply((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  return (
    <Section title="Project settings">
      <div className="flex flex-col gap-3" data-testid="project-settings">
        <Field label="Sample above" htmlFor="set-sample" hint="Rows. Larger results are previewed from a sample.">
          <CommitInput
            key={settings.sampleThresholdRows}
            id="set-sample"
            value={String(settings.sampleThresholdRows)}
            onCommit={(v) => {
              const n = Number(v.replace(/[,\s_]/g, ''));
              if (Number.isInteger(n) && n > 0) set({ sampleThresholdRows: n });
            }}
          />
        </Field>
        <Field label="Locale" htmlFor="set-locale" hint="How numbers and dates are written.">
          <Select id="set-locale" options={LOCALES} value={settings.locale} onChange={(e) => set({ locale: e.target.value })} />
        </Field>
        <Field label="Date formats" htmlFor="set-dates" hint="Tried in order when text is read as a date, separated by commas.">
          <CommitInput
            key={settings.defaultDateFormats.join(',')}
            id="set-dates"
            value={settings.defaultDateFormats.join(', ')}
            placeholder="%d/%m/%Y, %Y-%m-%d"
            onCommit={(v) => set({ defaultDateFormats: parseNullStrings(v) })}
          />
        </Field>
      </div>
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
      <>
        <Section title="Inspector">
          <p className="text-ink-muted">Select a node on the canvas to see its steps, settings and rules.</p>
        </Section>
        <ProjectSettings />
      </>
    );

  if (node.type === 'transform')
    return (
      <>
        <TransformPanel node={node} />
        <Columns nodeId={node.id} />
        <RulesPanel node={node} />
        <NodeNotes node={node} />
      </>
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
      {source && source.kind === 'file' && <AttachmentBanner source={source} />}
      {source && source.kind === 'url' && <UrlPanel source={source} />}
      {source && hasParseOptions(source) && <SourceOptions source={source} />}
      {node.type === 'output' && <OutputPanel node={node} />}
      <Columns nodeId={node.id} />
      <RulesPanel node={node} />
      <NodeNotes node={node} />
    </div>
  );
}
