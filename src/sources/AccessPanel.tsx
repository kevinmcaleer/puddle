import { setParseOptions, useProject, useProjectStore, type Source } from '../model';
import { Banner, Button, Field, Section, Select } from '../ui';
import { accessTableOf, addAccessTables, isLargeDatabase, tableLabel, tablesNotAdded, useAccessReads } from './access';
import { useAttachments } from './attachments';
import { formatBytes } from './excel';

/** Why an Access table can't be shown yet: being read, or what went wrong. Shared by the inspector and the results. */
export function AccessProblemBanner({ source }: { source: Source }) {
  const read = useAccessReads((s) => s.reads[source.id]);
  if (read?.state === 'failed') return <Banner tone="fail" title="This table can’t be read">{read.message}</Banner>;
  return <Banner tone="info" title="Reading the database">Access databases are read into memory whole, so a large one takes a moment.</Banner>;
}

/** The large-database warning: Access is read into memory, unlike CSV. */
function LargeDatabase({ source }: { source: Source }) {
  if (!isLargeDatabase(source)) return null;
  return (
    <div data-testid="access-large">
      <Banner tone="warn" title={`Large database (${formatBytes(source.file!.size)})`}>
        A database is read into memory whole, so this can be slow and use a lot of memory. For tables this size, export them from Access as CSV and add those instead.
      </Banner>
    </div>
  );
}

/** The inspector's read options for an Access source: which table, and adding the database's other tables as sources. */
export function AccessPanel({ source }: { source: Source }) {
  const apply = useProjectStore((s) => s.apply);
  const project = useProject();
  const read = useAccessReads((s) => s.reads[source.id]);
  const reads = useAccessReads((s) => s.reads);
  const attached = useAttachments((s) => (s.sources[source.id] ?? 'detached') !== 'detached');

  const tables = read && 'tables' in read ? read.tables : undefined;
  const current = accessTableOf(source, read) ?? tables?.[0]?.name ?? '';
  const options = tables?.length ? tables.map((t) => ({ value: t.name, label: tableLabel(t) })) : [{ value: current, label: current || 'First table' }];
  if (current && !options.some((t) => t.value === current)) options.unshift({ value: current, label: `${current} (not in this database)` });
  const others = attached && tables ? tablesNotAdded(project, source, tables, reads) : [];

  return (
    <Section title="Read options">
      <div className="flex flex-col gap-3" data-testid="access-panel" data-state={read?.state ?? 'none'}>
        <LargeDatabase source={source} />
        <Field label="Table" htmlFor="opt-table">
          <Select id="opt-table" options={options} value={current} disabled={!tables?.length} onChange={(e) => apply((p) => setParseOptions(p, source.id, { ...source.parseOptions, table: e.target.value }))} />
        </Field>
        {others.length > 0 && (
          <Field hint={`Adds a source for each of ${others.map((t) => t.name).join(', ')}, reading this same file.`}>
            <div>
              <Button size="sm" variant="secondary" icon="plus" data-testid="access-add-tables" onClick={() => addAccessTables(source, others.map((t) => t.name))}>
                {others.length === 1 ? `Add ${others[0]!.name}` : `Add the other ${others.length} tables`}
              </Button>
            </div>
          </Field>
        )}
        {attached && read?.state === 'failed' && <AccessProblemBanner source={source} />}
      </div>
    </Section>
  );
}
