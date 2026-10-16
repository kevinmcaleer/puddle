import { useEffect, useRef, useState } from 'react';
import { MAX_TRANSPOSE_ROWS } from '../compiler';
import type { TransposeRowsRead } from '../flow/transpose';
import type { ColumnSchema } from '../model';
import { Banner, Button } from '../ui';
import { rowsChange } from './unpivot';

/** Reads the step input's row count and the values of its first column (`header`). */
export type ReadTransposeRows = (header: string) => Promise<TransposeRowsRead>;

const rowsText = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'row' : 'rows'}`;

/**
 * How many rows Transpose was set up for, which fixes its columns, and Refresh rows to read the input again
 * (its columns too) and say what changed.
 */
export function TransposeRows({ params, columns, read, onChange }: { params: Record<string, unknown>; columns: ColumnSchema[]; read?: ReadTransposeRows; onChange: (params: Record<string, unknown>) => void }) {
  const [reading, setReading] = useState(false);
  const [report, setReport] = useState<{ tone: 'info' | 'fail'; text: string } | null>(null);
  const count = typeof params.rowCount === 'number' ? params.rowCount : undefined;

  async function refresh(say: boolean) {
    if (!read || !columns[0]) return;
    setReading(true);
    try {
      const got = await read(columns[0].name);
      const names = columns.map((c) => c.name);
      setReport(say ? { tone: 'info', text: rowsChange(count, got.rowCount, params.columns, names) } : null);
      onChange({ ...params, columns: names, ...got });
    } catch (e) {
      setReport({ tone: 'fail', text: `The rows couldn’t be read. ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setReading(false);
    }
  }

  // A step added before its input's columns were known has no rows yet: read them once the columns arrive.
  const asked = useRef(false);
  const ready = !!read && columns.length > 0;
  useEffect(() => {
    if (count != null || !ready || asked.current) return;
    asked.current = true;
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ready]);

  return (
    <div className="flex flex-col gap-2" data-testid="transpose-rows">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-ink-muted">
          {reading
            ? 'Reading the rows…'
            : count == null
              ? 'The rows haven’t been read yet.'
              : count > MAX_TRANSPOSE_ROWS
                ? `${rowsText(count)}: too many to transpose.`
                : `${rowsText(count)} become ${count === 1 ? 'a column' : `${count.toLocaleString('en')} columns`}.`}
        </span>
        <Button size="sm" variant="ghost" icon="refresh" disabled={!read || reading || !columns.length} onClick={() => void refresh(true)}>
          Refresh rows
        </Button>
      </div>
      {report?.tone === 'info' && <p role="status">{report.text}</p>}
      {report?.tone === 'fail' && <Banner tone="fail">{report.text}</Banner>}
    </div>
  );
}
