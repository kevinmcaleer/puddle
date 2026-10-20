import { useState } from 'react';
import { parseRange } from '../excel/range';
import { setParseOptions, useProject, useProjectStore, type ParseOptions, type Source } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, Field, Section, Select, Switch } from '../ui';
import { useAttachments } from './attachments';
import { addExcelTables, formatBytes, isLargeWorkbook, workbookSize, parseHeaderRow, parseHeaderRows, sheetLabel, sheetTableLabel, sheetTableOf, sheetTablesNotAdded, useExcelReads, withSheet } from './excel';

/** Why an Excel sheet can't be shown yet: being read, or what went wrong. Shared by the inspector and the results. */
export function ExcelProblemBanner({ source }: { source: Source }) {
  const read = useExcelReads((s) => s.reads[source.id]);
  if (read?.state === 'failed') return <Banner tone="fail" title="This sheet can’t be read">{read.message}</Banner>;
  return <Banner tone="info" title="Reading the workbook">Excel files are read into memory whole, so a large workbook takes a moment.</Banner>;
}

/** The large-workbook warning: Excel is read into memory, unlike CSV. */
function LargeWorkbook({ source }: { source: Source }) {
  if (!isLargeWorkbook(source)) return null;
  return (
    <div data-testid="excel-large">
      <Banner tone="warn" title={`Large workbook (${formatBytes(workbookSize(source))})`}>
        Unlike CSV, a workbook is read into memory whole, so this can be slow and use a lot of memory. For files this size, save the sheet as CSV and add that instead.
      </Banner>
    </div>
  );
}

/**
 * The inspector's read options for an Excel source: sheet, the table on it when there are several (with the sheet's
 * other tables to add as sources), header row and rows, cell range, and whether merged cells are filled. Changing
 * one reads the sheet again.
 */
export function ExcelPanel({ source }: { source: Source }) {
  const apply = useProjectStore((s) => s.apply);
  const project = useProject();
  const read = useExcelReads((s) => s.reads[source.id]);
  const reads = useExcelReads((s) => s.reads);
  const attached = useAttachments((s) => (s.sources[source.id] ?? 'detached') !== 'detached');
  const [headerError, setHeaderError] = useState<string>();
  const [headerRowsError, setHeaderRowsError] = useState<string>();
  const [rangeError, setRangeError] = useState<string>();
  const o = source.parseOptions;
  const set = (next: ParseOptions) => apply((p) => setParseOptions(p, source.id, next));
  const without = (key: keyof ParseOptions) => {
    const next = { ...o };
    delete next[key];
    return next;
  };

  const sheets = read && 'sheets' in read ? read.sheets : undefined;
  const current = o.sheet ?? (read?.state === 'ok' ? read.sheet : sheets?.[0]?.name) ?? '';
  const sheetOptions = sheets?.length ? sheets.map((s) => ({ value: s.name, label: sheetLabel(s) })) : [{ value: current, label: current || 'First sheet' }];
  if (current && !sheetOptions.some((s) => s.value === current)) sheetOptions.unshift({ value: current, label: `${current} (not in this workbook)` });
  const detected = read?.state === 'ok' && o.headerRow == null ? (read.headerRow ? `Detect (row ${read.headerRow})` : 'Detect') : 'Detect';
  const detectedRows = read?.state === 'ok' && o.headerRows == null && read.headerRows ? `Detect (${read.headerRows === 1 ? '1 row' : `${read.headerRows} rows`})` : 'Detect';
  // The tables found on the sheet, when there are several: the one read, and the rest to add as sources of their own.
  const tables = read?.state === 'ok' && read.tables.length > 1 ? read.tables : undefined;
  const table = sheetTableOf(source, read) ?? '';
  const tableOptions = tables ? tables.map((t) => ({ value: t.range, label: sheetTableLabel(t) })) : [];
  if (tables && table && !tableOptions.some((t) => t.value === table)) tableOptions.unshift({ value: table, label: `${table} (chosen range)` });
  const others = attached ? sheetTablesNotAdded(project, source, read, reads) : [];
  const merges = read?.state === 'ok' ? read.merges : 0;

  return (
    <Section title="Read options">
      <div className="flex flex-col gap-3" data-testid="excel-panel" data-state={read?.state ?? 'none'}>
        <LargeWorkbook source={source} />
        <Field label="Sheet" htmlFor="opt-sheet">
          <Select id="opt-sheet" options={sheetOptions} value={current} disabled={!sheets?.length} onChange={(e) => {
              setHeaderError(undefined);
              setRangeError(undefined);
              set(withSheet(o, e.target.value));
            }}
          />
        </Field>
        {tables && (
          <Field label="Table" htmlFor="opt-table" hint="Blocks of cells with blank rows between them are tables of their own; the largest is read unless one is chosen.">
            <Select id="opt-table" options={tableOptions} value={table} onChange={(e) => {
                setRangeError(undefined);
                set({ ...o, range: e.target.value });
              }}
            />
          </Field>
        )}
        {others.length > 0 && (
          <Field hint={`Adds a source for each of ${others.map((t) => t.range).join(', ')}, reading this same file.`}>
            <div>
              <Button size="sm" variant="secondary" icon="plus" data-testid="excel-add-tables" onClick={() => addExcelTables(source, others)}>
                {others.length === 1 ? `Add the table at ${others[0]!.range}` : `Add the other ${others.length} tables`}
              </Button>
            </div>
          </Field>
        )}
        <Field label="Header row" htmlFor="opt-header-row" hint="Row number in the sheet. Leave empty to detect it, or 0 for none." error={headerError}>
          <CommitInput
            key={`${current}:${o.headerRow ?? ''}`}
            id="opt-header-row"
            value={o.headerRow == null ? '' : String(o.headerRow)}
            placeholder={detected}
            error={!!headerError}
            onCommit={(text) => {
              const n = parseHeaderRow(text);
              if (n === undefined) return setHeaderError('Enter a row number, such as 3.');
              setHeaderError(undefined);
              set(n === 'auto' ? without('headerRow') : { ...o, headerRow: n });
            }}
          />
        </Field>
        <Field label="Header rows" htmlFor="opt-header-rows" hint="How many rows the header takes, 1 to 3; their names are joined, as in Q1 Jan. Leave empty to detect it from the merged cells." error={headerRowsError}>
          <CommitInput
            key={`${current}:${o.headerRows ?? ''}`}
            id="opt-header-rows"
            value={o.headerRows == null ? '' : String(o.headerRows)}
            placeholder={detectedRows}
            error={!!headerRowsError}
            onCommit={(text) => {
              const n = parseHeaderRows(text);
              if (n === undefined) return setHeaderRowsError('Enter 1, 2 or 3.');
              setHeaderRowsError(undefined);
              set(n === 'auto' ? without('headerRows') : { ...o, headerRows: n });
            }}
          />
        </Field>
        <Field label="Cell range" htmlFor="opt-range" hint={read?.state === 'ok' && !o.range ? `Optional. Reading ${read.range}.` : 'Optional, such as A3:F200.'} error={rangeError}>
          <CommitInput
            key={`${current}:${o.range ?? ''}`}
            id="opt-range"
            mono
            value={o.range ?? ''}
            placeholder="A1:F200"
            error={!!rangeError}
            onCommit={(text) => {
              const t = text.trim().toUpperCase();
              if (t && !parseRange(t)) return setRangeError('Write a range like A1:F200.');
              setRangeError(undefined);
              set(t ? { ...o, range: t } : without('range'));
            }}
          />
        </Field>
        {(merges > 0 || o.fillMerges === false) && (
          <Field hint="Every cell of a merged cell takes its value, so a region merged down its rows is on each of them.">
            <Switch id="opt-fill-merges" label="Fill merged cells" checked={o.fillMerges !== false} onChange={(on) => set(on ? without('fillMerges') : { ...o, fillMerges: false })} />
          </Field>
        )}
        {attached && read?.state === 'failed' && <ExcelProblemBanner source={source} />}
      </div>
    </Section>
  );
}
