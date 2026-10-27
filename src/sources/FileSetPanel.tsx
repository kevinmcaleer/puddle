import { useRef } from 'react';
import { useSession } from '../app/session';
import { fileSetMembers } from '../compiler';
import { formatLabel } from '../canvas/formatLabel';
import { setFileSet, useProjectStore, type Source } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, Field, Section, Switch } from '../ui';
import { useAttachments } from './attachments';
import { detachedMessage } from './attach';
import { FileSetInputs } from './FileSetInputs';
import { rechooseFileSet, setFilesOf } from './fileSet';

/** How many file names the panel lists before "and N more". */
const LISTED = 8;

const report = (err: unknown) => useSession.getState().notify({ tone: 'fail', text: err instanceof Error ? err.message : String(err) });

/** Choose a set's files, or its folder, again. */
function ChooseAgain({ source, again }: { source: Source; again?: boolean }) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const take = (chosen: File[]) => {
    const picked = setFilesOf(chosen);
    rechooseFileSet(source, picked.files, picked.folder).catch(report);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={again ? 'secondary' : 'primary'} icon="source" onClick={() => folder.current?.click()}>{again ? 'Choose another folder' : 'Choose folder'}</Button>
      <Button size="sm" variant="secondary" icon="source" onClick={() => files.current?.click()}>{again ? 'Choose other files' : 'Choose files'}</Button>
      <FileSetInputs files={files} folder={folder} onFiles={take} testId={`file-set-${source.id}`} />
    </div>
  );
}

/** The inspector for a file set: its files, which of them are read, a column naming each row's file, and where the runner finds them. */
export function FileSetPanel({ source }: { source: Source }) {
  const apply = useProjectStore((s) => s.apply);
  const state = useAttachments((s) => s.sources[source.id] ?? 'detached');
  const set = source.fileSet;
  if (!set) return null;
  const members = fileSetMembers(source);
  const kind = formatLabel(source.format);
  return (
    <div data-testid="file-set-panel">
      {state === 'detached' && (
        <div className="px-4 pt-3" data-testid="attachment-banner" data-state={state}>
          <Banner tone="warn" title="Files not connected" action={<ChooseAgain source={source} />}>
            {detachedMessage(source)}
          </Banner>
        </div>
      )}
      <Section title="Files" count={members.length}>
        <div className="flex flex-col gap-3">
          <p className="text-ink-muted" data-testid="file-set-summary">
            {members.length === set.files.length ? `${set.files.length} ${kind} ${set.files.length === 1 ? 'file' : 'files'}` : `${members.length} of ${set.files.length} ${kind} files`}
            {set.folder ? ` from the folder ${set.folder}` : ''}, read as one table with their columns lined up by name.
          </p>
          <ul className="flex flex-col gap-1 font-mono text-label text-ink" data-testid="file-set-files">
            {members.slice(0, LISTED).map((f) => (
              <li key={f.name} className="truncate" title={f.name}>{f.name}</li>
            ))}
            {members.length > LISTED && <li className="text-ink-muted">and {members.length - LISTED} more</li>}
          </ul>
          <Field label="Only files matching" htmlFor="file-set-pattern" hint="A pattern such as *.parquet or 2024-*.csv; * stands for any characters. Empty reads every file.">
            <CommitInput key={set.pattern ?? ''} id="file-set-pattern" value={set.pattern ?? ''} placeholder={`*.${source.format === 'ndjson' ? 'ndjson' : source.format}`} onCommit={(v) => apply((p) => setFileSet(p, source.id, { pattern: v.trim() || undefined }))} />
          </Field>
          {set.pattern && !members.length && <Banner tone="warn">No file matches {set.pattern}.</Banner>}
          <Switch label="Add a column naming each row’s file" checked={!!set.fileColumn} onChange={(on) => apply((p) => setFileSet(p, source.id, { fileColumn: on || undefined }))} />
          {state !== 'detached' && <ChooseAgain source={source} again />}
        </div>
      </Section>
      <Section title="On the runner">
        <Field label="Path to the folder" htmlFor="opt-runner-path" hint="For puddle-run: absolute, or relative to the project file. It reads the files there that the pattern matches, or, with no pattern, the files chosen here. Empty: a folder of the same name beside the project file or in its sources folder, else the project file’s own folder.">
          <CommitInput key={set.path ?? ''} id="opt-runner-path" value={set.path ?? ''} placeholder={set.folder ?? 'data'} onCommit={(v) => apply((p) => setFileSet(p, source.id, { path: v.trim() || undefined }))} />
        </Field>
      </Section>
    </div>
  );
}
