import type { ColumnSchema } from '../model';
import { FILTER_OPS } from '../compiler';
import { Button, Select } from '../ui';
import { CommitInput } from './CommitInput';

export type Condition = { column: string; op: string; value: string };

const OPS = Object.entries(FILTER_OPS).map(([value, label]) => ({ value, label }));
const NO_VALUE = new Set(['empty', 'notEmpty']);

/** Filter conditions: column, comparison and value per row. The filter step and the pivot editor share it. */
export function Conditions({ value, columns, onChange }: { value: Condition[]; columns: ColumnSchema[]; onChange: (v: Condition[]) => void }) {
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((c, i) => (
        <div key={i} className="flex flex-col gap-1 border-b border-line pb-2">
          <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Select aria-label={`Condition ${i + 1} column`} options={[...new Set([c.column, ...columns.map((x) => x.name)])]} value={c.column} onChange={(e) => set(i, { column: e.target.value })} />
            <Select aria-label={`Condition ${i + 1} comparison`} options={OPS} value={c.op} onChange={(e) => set(i, { op: e.target.value })} />
            <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove condition ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))} />
          </div>
          {!NO_VALUE.has(c.op) && <CommitInput key={c.value} aria-label={`Condition ${i + 1} value`} mono value={c.value} onCommit={(v) => set(i, { value: v })} />}
        </div>
      ))}
      <Button variant="ghost" size="sm" icon="plus" onClick={() => onChange([...value, { column: columns[0]?.name ?? '', op: 'equals', value: '' }])}>Add condition</Button>
    </div>
  );
}
