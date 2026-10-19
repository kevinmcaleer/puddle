import { useEffect, useState } from 'react';
import { useSession } from '../app/session';
import { useNodeStatus } from '../flow/status';
import { updateSource, useProject, useProjectStore, type Source } from '../model';
import { useAttachments } from '../sources/attachments';
import { ReattachButton } from '../sources/ReattachButton';
import { suggestedMapping, missingColumns } from '../templates/mapping';
import { Columns, Mapping } from '../templates/Mapping';
import { Banner, Dialog, Field, TextInput } from '../ui';
import { exportRecipe, openExportRecipe, useRecipeDialog } from './actions';
import { matchSource } from './match';

/** Name and describe the open project's recipe, then download it. */
function ExportDialog() {
  const project = useProject();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState('');
  const close = () => openExportRecipe(false);
  return (
    <Dialog
      title="Share as recipe"
      confirm="Share as recipe"
      confirmDisabled={!name.trim()}
      onClose={close}
      onConfirm={() => {
        close();
        exportRecipe({ name, description });
      }}
      className="w-[560px] max-w-[calc(100vw-32px)]"
    >
      <p className="text-label text-ink-muted">
        A recipe keeps the nodes, steps, rules and notes, and the columns each source is expected to have. It never holds rows, file names, kept results, or the credentials and query
        strings of web addresses, so you can share how you cleaned something without sharing what you cleaned.
      </p>
      <Field label="Name" htmlFor="recipe-name">
        <TextInput id="recipe-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="recipe-description">
        <textarea
          id="recipe-description"
          className="ui-input min-h-[var(--size-row)] w-full resize-y py-1"
          rows={2}
          value={description}
          placeholder="What it cleans, and what it expects."
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/**
 * Sources of a project opened from a recipe that still wait for their first file: each with the columns it expects
 * and a button to choose one.
 */
export function RecipeAttachBanner() {
  const sources = useProject().sources;
  const attachments = useAttachments((s) => s.sources);
  const waiting = sources.filter((s) => s.expected && s.kind === 'file' && (attachments[s.id] ?? 'detached') === 'detached');
  if (!waiting.length) return null;
  return (
    <div className="border-b border-line px-3 py-2" data-testid="recipe-attach">
      <Banner tone="info" title={waiting.length === 1 ? 'Attach a file to run this recipe' : `Attach ${waiting.length} files to run this recipe`}>
        <p>Recipes hold the steps, not the data. Choose a file with these columns; if its columns are named differently, Puddle asks which to use.</p>
        <ul className="mt-2 flex flex-col gap-2">
          {waiting.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2" aria-label={`${s.name} expects`}>
              <span className="text-body-strong">{s.name}</span>
              <span className="text-label text-ink-muted">{s.format.toUpperCase()}</span>
              <Columns columns={s.expected!} />
              <ReattachButton source={s} label={`Choose ${s.name}`} />
            </li>
          ))}
        </ul>
      </Banner>
    </div>
  );
}

/** Once a recipe source's file is read, check its columns: settle quietly when they fit, or ask which to use. */
function MatchSource({ source, nodeId }: { source: Source; nodeId: string }) {
  const status = useNodeStatus(nodeId);
  const actual = status.state === 'ok' ? status.columns : undefined;
  const expected = source.expected!;
  const fits = !!actual && missingColumns(expected, actual).length === 0;
  const [picks, setPicks] = useState<Record<string, string>>({});
  useEffect(() => {
    if (fits) useProjectStore.getState().amend((p) => updateSource(p, source.id, { expected: undefined }));
  }, [fits, source.id]);
  if (!actual || fits) return null;
  const mapping: Record<string, string | undefined> = { ...suggestedMapping(expected, actual), ...Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, v || undefined])) };
  // Declining the mapping is a choice, so an undo step: undo asks again.
  const forget = () => useProjectStore.getState().apply((p) => updateSource(p, source.id, { expected: undefined }));
  return (
    <Dialog
      title={`Match the columns of ${source.name}`}
      confirm="Use these columns"
      onClose={forget}
      onConfirm={() => {
        const before = useProjectStore.getState().history.present;
        useProjectStore.getState().apply((p) => matchSource(p, source.id, actual, mapping));
        const after = useProjectStore.getState().history.present;
        const off = (p: typeof before) => p.nodes.flatMap((n) => (n.type === 'transform' ? n.steps : [])).filter((s) => !s.enabled).length;
        const turnedOff = off(after) - off(before);
        useSession
          .getState()
          .notify(turnedOff ? { tone: 'warn', text: `${turnedOff} ${turnedOff === 1 ? 'step is' : 'steps are'} turned off: ${turnedOff === 1 ? 'it needs a column' : 'they need columns'} the file doesn’t have.` } : null);
      }}
      className="w-[560px] max-w-[calc(100vw-32px)]"
    >
      <p className="text-label text-ink-muted">The recipe expects these columns from {source.name}:</p>
      <Columns columns={expected} />
      <Mapping expected={expected} actual={actual} mapping={mapping} what="the recipe" testId="recipe-mapping" onChange={(name, column) => setPicks({ ...picks, [name]: column })} />
    </Dialog>
  );
}

/** The recipe dialogs of the editor: exporting, and matching an attached file's columns to a recipe's. */
export function RecipeDialogs() {
  const exporting = useRecipeDialog((s) => s.open);
  const project = useProject();
  const attachments = useAttachments((s) => s.sources);
  // One source at a time: the first recipe source whose file has been chosen.
  const source = project.sources.find((s) => s.expected && (attachments[s.id] ?? 'detached') !== 'detached');
  const node = source && project.nodes.find((n) => n.type === 'source' && n.sourceId === source.id);
  return (
    <>
      {exporting && <ExportDialog />}
      {source && node && <MatchSource key={source.id} source={source} nodeId={node.id} />}
    </>
  );
}
