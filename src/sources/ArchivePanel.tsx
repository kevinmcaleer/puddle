import type { Source } from '../model';
import { Banner, Button, Field, Section, Select } from '../ui';
import { addArchiveEntries, changeArchiveEntry, entriesNotAdded, entryLabel, useArchives } from './archive';
import { useArrowReads } from './arrow';
import { useAttachments } from './attachments';
import { useProject } from '../model';

/** The inspector's panel for a source read from a .gz or .zip: which file inside is read, and adding the others. */
export function ArchivePanel({ source }: { source: Source & { archive: NonNullable<Source['archive']> } }) {
  const project = useProject();
  const entries = useArchives((s) => s.entries[source.id]);
  const attached = useAttachments((s) => (s.sources[source.id] ?? 'detached') !== 'detached');
  const current = source.archive.entry;
  const options = entries?.length ? entries.map((e) => ({ value: e.name, label: entryLabel(e) })) : [{ value: current, label: current }];
  if (!options.some((o) => o.value === current)) options.unshift({ value: current, label: `${current} (not in this archive)` });
  const others = attached && entries ? entriesNotAdded(project, source, entries) : [];
  const archiveName = source.file?.originalName ?? '';
  return (
    <Section title={source.archive.kind === 'zip' ? 'Zip archive' : 'Compressed file'}>
      <div className="flex flex-col gap-3" data-testid="archive-panel" data-kind={source.archive.kind}>
        <Field label="File inside" htmlFor="opt-entry" hint={source.archive.kind === 'zip' ? `Read from ${archiveName}; it is unpacked in your browser.` : `Unpacked from ${archiveName} as it is read.`}>
          <Select id="opt-entry" options={options} value={current} disabled={source.archive.kind !== 'zip' || !entries || entries.length < 2 || !attached} onChange={(e) => void changeArchiveEntry(source.id, e.target.value)} />
        </Field>
        {others.length > 0 && (
          <Field hint={`Adds a source for each of ${others.map((e) => e.name).join(', ')}, reading this same archive.`}>
            <div>
              <Button size="sm" variant="secondary" icon="plus" data-testid="archive-add-entries" onClick={() => void addArchiveEntries(source, others.map((e) => e.name))}>
                {others.length === 1 ? `Add ${others[0]!.name}` : `Add the other ${others.length} files`}
              </Button>
            </div>
          </Field>
        )}
      </div>
    </Section>
  );
}

/** Why an Arrow file can't be shown yet: being read, or what went wrong. Shared by the inspector and the results. */
export function ArrowProblemBanner({ source }: { source: Source }) {
  const read = useArrowReads((s) => s.reads[source.id]);
  if (read?.state === 'failed') return <Banner tone="fail" title="This file can’t be read">{read.message}</Banner>;
  return <Banner tone="info" title="Reading the Arrow file">Arrow files are read into memory whole, so a large one takes a moment.</Banner>;
}
