import { useSession } from '../app/session';
import { NotesPanel } from '../notes/NotesPanel';
import { inspectorTabs, shownTab } from './tabs';
import { useNodeStatus } from '../flow/status';
import { sourceFormatLabel } from '../canvas/formatLabel';
import { nodeById, setParseOptions, setRunnerPath, useProject, useProjectStore, type GraphNode, type ParseOptions, type ProjectSettings as ProjectSettingsT, type Source } from '../model';
import { Banner, browserLocale, columnKind, DISPLAY_LOCALES, Field, formatDateText, formatNumberText, Icon, NODE_KIND, Section, Select, Switch, Tabs, TypeTag, useDisplay, useDisplayFormat, type DateDisplay } from '../ui';
import { CommitInput } from '../steps/StepForm';
import { AppendPanel } from './AppendPanel';
import { JoinPanel } from './JoinPanel';
import { LookupPanel } from './LookupPanel';
import { KeepPanel } from './KeepPanel';
import { NodeNotes } from './NodeNotes';
import { OutputPanel } from './OutputPanel';
import { QueryPanel } from './QueryPanel';
import { RulesPanel } from './RulesPanel';
import { SqlPanel } from './SqlPanel';
import { TransformPanel } from './TransformPanel';
import { useAttachments } from '../sources/attachments';
import { DetachedMessage } from '../sources/ReconnectBanner';
import { ReattachButton } from '../sources/ReattachButton';
import { UrlPanel } from '../sources/UrlPanel';
import { isExcelSource } from '../sources/excel';
import { ExcelPanel } from '../sources/ExcelPanel';
import { isXmlSource } from '../sources/xml';
import { XmlPanel } from '../sources/XmlPanel';
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
          <DetachedMessage source={source} />
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
        <Field label="Locale" htmlFor="set-locale" hint="How this project’s data writes numbers. New parse numbers steps start with it.">
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
        <Field hint="Steps added from the results table (quick fixes and the column menu) each go in a new Transform node, so every step shows on the canvas.">
          <Switch label="Add each step as a new node" checked={settings.stepsAsNodes} onChange={(on) => set({ stepsAsNodes: on })} />
        </Field>
        <Field label="Run on a schedule" htmlFor="set-schedule" hint="Cron syntax for puddle-run on your own machine, e.g. 0 3 * * * for 03:00 every day. Empty: never.">
          <CommitInput key={settings.schedule ?? ''} id="set-schedule" value={settings.schedule ?? ''} placeholder="0 3 * * *" onCommit={(v) => set({ schedule: v.trim() || undefined })} />
        </Field>
      </div>
    </Section>
  );
}

/** Where puddle-run finds this file on the machine it runs on; the browser never reads it. */
function RunnerPath({ source }: { source: Source }) {
  const apply = useProjectStore((s) => s.apply);
  const path = source.file?.path ?? '';
  return (
    <Section title="On the runner">
      <Field label="Path to this file" htmlFor="opt-runner-path" hint="For puddle-run: absolute, or relative to the project file. Empty: a file with the same name beside the project file or in its sources folder.">
        <CommitInput key={path} id="opt-runner-path" value={path} placeholder={`sources/${source.file?.originalName ?? ''}`} onCommit={(v) => apply((p) => setRunnerPath(p, source.id, v.trim()))} />
      </Field>
    </Section>
  );
}

/** How numbers and dates look on this device: a viewer's preference, kept out of the project. */
function DisplaySettings() {
  const preference = useDisplay((s) => s.preference);
  const setPreference = useDisplay((s) => s.setPreference);
  const format = useDisplayFormat();
  const example = `${formatNumberText('1234567.89', format.locale)} · ${formatDateText('2026-12-31 14:05:09', format)}`;
  return (
    <Section title="Display">
      <div className="flex flex-col gap-3" data-testid="display-settings">
        <Field label="Show numbers and dates as" htmlFor="set-display-locale" hint="On this device only. Values, steps and exports stay as they are.">
          <Select
            id="set-display-locale"
            options={[{ value: 'browser', label: `The browser’s language (${browserLocale()})` }, ...DISPLAY_LOCALES]}
            value={preference.locale}
            onChange={(e) => setPreference({ locale: e.target.value })}
          />
        </Field>
        <Field label="Show dates" htmlFor="set-display-dates" hint={<span data-testid="display-example">{example}</span>}>
          <Select
            id="set-display-dates"
            options={[
              { value: 'locale', label: 'In the locale’s short form' },
              { value: 'iso', label: 'As ISO 8601 (2026-12-31)' },
            ]}
            value={preference.dates}
            onChange={(e) => setPreference({ dates: e.target.value as DateDisplay })}
          />
        </Field>
      </div>
    </Section>
  );
}

/**
 * The right-hand panel, in three tabs: the selected node (what it is, how it reads or transforms data, its columns
 * and rules), the project (its settings and this device's display settings) and the project notes.
 */
export function Inspector() {
  const project = useProject();
  const selectedId = useSession((s) => s.selectedNodeId);
  const asked = useSession((s) => s.inspectorTab);
  const setTab = useSession((s) => s.setInspectorTab);
  const node = selectedId ? nodeById(project, selectedId) : undefined;
  const tab = shownTab(asked, !!node);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-line px-4 py-2" data-testid="inspector-tabs">
        <Tabs label="Inspector" items={inspectorTabs(!!node)} value={tab} onChange={(id) => setTab(id as typeof tab)} />
      </div>
      {tab === 'notes' ? (
        <NotesPanel />
      ) : tab === 'project' || !node ? (
        <div className="min-h-0 flex-1 overflow-auto" data-testid="inspector-project">
          <ProjectSettings />
          <DisplaySettings />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <NodeInspector node={node} />
        </div>
      )}
    </div>
  );
}

/** The Node tab: what the selected node is, how it reads or transforms data, and its columns and rules. */
function NodeInspector({ node }: { node: GraphNode }) {
  const project = useProject();

  if (node.type === 'transform')
    return (
      <>
        <TransformPanel node={node} />
        <KeepPanel key={node.id} node={node} />
        <Columns nodeId={node.id} />
        <RulesPanel node={node} />
        <NodeNotes node={node} />
      </>
    );

  if (node.type === 'join')
    return (
      <>
        <JoinPanel node={node} />
        <KeepPanel key={node.id} node={node} />
        <Columns nodeId={node.id} />
        <RulesPanel node={node} />
        <NodeNotes node={node} />
      </>
    );
  if (node.type === 'append')
    return (
      <>
        <AppendPanel node={node} />
        <KeepPanel key={node.id} node={node} />
        <Columns nodeId={node.id} />
        <RulesPanel node={node} />
        <NodeNotes node={node} />
      </>
    );
  if (node.type === 'lookup')
    return (
      <>
        <LookupPanel node={node} />
        <KeepPanel key={node.id} node={node} />
        <Columns nodeId={node.id} />
        <RulesPanel node={node} />
        <NodeNotes node={node} />
      </>
    );

  if (node.type === 'sql')
    return (
      <>
        <SqlPanel node={node} />
        <KeepPanel key={node.id} node={node} />
        <Columns nodeId={node.id} />
        <RulesPanel node={node} />
        <NodeNotes node={node} />
      </>
    );

  if (node.type === 'query')
    return (
      <>
        <QueryPanel node={node} />
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
          <div className="text-label text-ink-muted">{source ? `${kind.label} · ${sourceFormatLabel(source)}` : kind.label}</div>
        </div>
      </div>
      {source && source.kind === 'file' && <AttachmentBanner source={source} />}
      {source && source.kind === 'url' && <UrlPanel source={source} />}
      {source && isExcelSource(source) && <ExcelPanel source={source} />}
      {source && isXmlSource(source) && <XmlPanel source={source} />}
      {source && hasParseOptions(source) && <SourceOptions source={source} />}
      {source && source.kind === 'file' && <RunnerPath source={source} />}
      {node.type === 'output' && <OutputPanel node={node} />}
      {node.type === 'source' && <KeepPanel key={node.id} node={node} />}
      <Columns nodeId={node.id} />
      <RulesPanel node={node} />
      <NodeNotes node={node} />
    </div>
  );
}
