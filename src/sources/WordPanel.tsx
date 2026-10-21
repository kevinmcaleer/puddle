import { useProject, type ParseOptions, type Source } from '../model';
import { Button, Field, Select } from '../ui';
import { wordTableLabel } from '../word';
import { useAttachments } from './attachments';
import { HeaderSwitch, NullStringsField } from './CsvOptions';
import { useRewrites } from './rewrite';
import { RewriteProblemBanner } from './TextPanels';
import { addWordTables, tablesNotAdded } from './word';

const plural = (n: number, word: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? word : `${word}s`}`;

/** The inspector's read options for a Word document: which of its tables is read, and adding the others. */
export function WordOptions({ source, onChange }: { source: Source; onChange: (options: ParseOptions) => void }) {
  const project = useProject();
  const o = source.parseOptions;
  const read = useRewrites((s) => s.reads[source.id]);
  const attached = useAttachments((s) => (s.sources[source.id] ?? 'detached') !== 'detached');
  const tables = read?.state === 'ok' ? (read.tables ?? []) : [];
  const current = o.table ?? (read?.state === 'ok' && read.table != null ? String(read.table) : '');
  const options = tables.length ? tables.map((t) => ({ value: String(t.index), label: wordTableLabel(t) })) : [{ value: current, label: current ? `Table ${current}` : 'The biggest table' }];
  if (!options.some((t) => t.value === current)) options.unshift({ value: current, label: `Table ${current} (not in this document)` });
  const others = attached && tables.length ? tablesNotAdded(project, source, tables) : [];
  const props = { options: o, onChange };
  return (
    <>
      <Field label="Table" htmlFor="opt-table" hint="The tables in the document, named by their captions or the headings above them. The biggest is read unless another is chosen.">
        <Select id="opt-table" options={options} value={current} disabled={tables.length < 2} onChange={(e) => onChange({ ...o, table: e.target.value })} />
      </Field>
      {read?.state === 'ok' && (
        <p className="text-label text-ink-muted" data-testid="rewrite-size">
          {`${plural(read.rows, 'row')}, ${plural(read.columns, 'column')}`}
        </p>
      )}
      <HeaderSwitch {...props} />
      <NullStringsField {...props} />
      {others.length > 0 && (
        <Field hint={`Adds a source for each of ${others.map((t) => t.label).join(', ')}, reading this same document.`}>
          <div>
            <Button size="sm" variant="secondary" icon="plus" data-testid="word-add-tables" onClick={() => void addWordTables(source, others)}>
              {others.length === 1 ? `Add ${others[0]!.label}` : `Add the other ${others.length} tables`}
            </Button>
          </div>
        </Field>
      )}
      {read?.state === 'failed' && <RewriteProblemBanner source={source} />}
    </>
  );
}
