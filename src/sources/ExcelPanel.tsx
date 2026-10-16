import { useState } from 'react';
import { parseRange } from '../excel/range';
import { setParseOptions, useProjectStore, type ParseOptions, type Source } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Field, Section, Select } from '../ui';
import { useAttachments } from './attachments';
import { formatBytes, isLargeWorkbook, parseHeaderRow, sheetLabel, useExcelReads, withSheet } from './excel';

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
      <Banner tone="warn" title={`Large workbook (${formatBytes(source.file!.size)})`}>
        Unlike CSV, a workbook is read into memory whole, so this can be slow and use a lot of memory. For files this size, save the sheet as CSV and add that instead.
      </Banner>
    </div>
  );
}

/** The inspector's read options for an Excel source: sheet, header row and cell range. Changing one reads the sheet again. */
export function ExcelPanel({ source }: { source: Source }) {
  const apply = useProjectStore((s) => s.apply);
  const read = useExcelReads((s) => s.reads[source.id]);
  const attached = useAttachments((s) => (s.sources[source.id] ?? 'detached') !== 'detached');
  const [headerError, setHeaderError] = useState<string>();
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
        {attached && read?.state === 'failed' && <ExcelProblemBanner source={source} />}
      </div>
    </Section>
  );
}
