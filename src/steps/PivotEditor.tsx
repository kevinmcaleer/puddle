import { useEffect, useRef, useState, type DragEvent } from 'react';
import { AGGREGATES, FILTER_OPS, pivotOutputs, type Aggregate, type Condition } from '../compiler';
import type { PivotValuesRead } from '../flow/pivot';
import type { ColumnSchema } from '../model';
import { Banner, Button, columnKind, Field, FieldChip, Menu, PivotZone, TypeTag, type MenuItem } from '../ui';
import { CommitInput } from './CommitInput';
import { Conditions } from './Conditions';
import { addToZone, moveField, pivotDraft, pivotValuesChange, removeFromZone, renameOutput, setAggregate, valuesStale, ZONES, zoneFields, type PivotDraft, type Zone } from './pivot';

/** Reads the values a Columns field turns into columns, from the step's input after the filters. */
export type ReadPivotValues = (pivot: { column: string; filters: Condition[] }) => Promise<PivotValuesRead>;

const DRAG = 'application/x-puddle-field';
/** What's being dragged: a field from the list, or one already in a zone. */
type Dragged = { column: string; zone?: Zone; index?: number };

const ERROR_KEYS = ['rows', 'column', 'pivotValues', 'values', 'filters', 'names'];
const EMPTY: Record<Zone, string> = { filters: 'Drag columns here', column: 'Drag a column here to pivot', rows: 'Drag columns here', values: 'Drag columns here' };
const shown = (values: string[]) => (values.length > 4 ? `${values.slice(0, 4).join(', ')} and ${values.length - 4} more` : values.join(', '));

const startDrag = (what: Dragged) => (e: DragEvent) => {
  e.dataTransfer.setData(DRAG, JSON.stringify(what));
  e.dataTransfer.effectAllowed = 'move';
};

/** One drop zone and its fields, each draggable and with a menu for moving it by keyboard. */
function ZoneBox({ zone, label, draft: d, columns, commit }: { zone: Zone; label: string; draft: PivotDraft; columns: ColumnSchema[]; commit: (next: PivotDraft) => void }) {
  const [over, setOver] = useState(false);
  const fields = zoneFields(d, zone);

  const kind = (name: string) => {
    const c = columns.find((x) => x.name === name);
    return c ? columnKind(c.type) : undefined;
  };
  const accept = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  const leave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  const drop = (at?: number) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    let what: Dragged;
    try {
      what = JSON.parse(e.dataTransfer.getData(DRAG)) as Dragged;
    } catch {
      return;
    }
    commit(what.zone && what.index != null ? moveField(d, what.zone, what.index, zone, columns, at) : addToZone(d, what.column, zone, columns, at));
  };

  /** Moving a field by keyboard: up, down, or to another zone. */
  const moves = (i: number): MenuItem[] => [
    ...(zone !== 'column' && i > 0 ? [{ label: 'Move up', onSelect: () => commit(moveField(d, zone, i, zone, columns, i - 1)) }] : []),
    ...(zone !== 'column' && i < fields.length - 1 ? [{ label: 'Move down', onSelect: () => commit(moveField(d, zone, i, zone, columns, i + 2)) }] : []),
    ...ZONES.filter((z) => z.zone !== zone).map((z) => ({ label: `Move to ${z.label.toLowerCase()}`, onSelect: () => commit(moveField(d, zone, i, z.zone, columns)) })),
  ];

  const tag = (i: number) => {
    if (zone === 'values') {
      const v = d.values[i]!;
      return (
        <Menu
          align="end"
          label={AGGREGATES[v.agg]}
          items={(Object.keys(AGGREGATES) as Aggregate[]).map((a) => ({ label: AGGREGATES[a].charAt(0).toUpperCase() + AGGREGATES[a].slice(1), onSelect: () => commit(setAggregate(d, i, a)) }))}
          renderTrigger={(t) => (
            <button type="button" className="ui-fchip__agg" aria-label={`Summarise ${v.column}: ${AGGREGATES[v.agg]}`} {...t}>
              {AGGREGATES[v.agg] ?? v.agg}
            </button>
          )}
        />
      );
    }
    if (zone === 'filters') {
      const f = d.filters[i]!;
      return `${FILTER_OPS[f.op] ?? f.op}${f.op === 'empty' || f.op === 'notEmpty' ? '' : ` ${f.value}`}`;
    }
    if (zone === 'column' && d.pivotValues.length) return `${d.pivotValues.length} ${d.pivotValues.length === 1 ? 'value' : 'values'}`;
    return undefined;
  };

  return (
    <div role="group" aria-label={label} data-zone={zone} onDragOver={accept} onDragLeave={leave} onDrop={drop()}>
      <PivotZone label={label} over={over} empty={EMPTY[zone]}>
        {fields.map((name, i) => (
          <FieldChip
            key={`${i}-${name}`}
            name={name}
            type={kind(name)}
            onDragStart={startDrag({ column: name, zone, index: i })}
            onDragOver={accept}
            onDrop={drop(i)}
            label={
              <Menu
                align="start"
                className="flex min-w-0 flex-auto"
                label={name}
                items={moves(i)}
                renderTrigger={(t) => (
                  <button type="button" className="ui-fchip__name" title={name} aria-label={`${label}: ${name}`} {...t}>
                    {name}
                  </button>
                )}
              />
            }
            agg={tag(i)}
            onRemove={() => commit(removeFromZone(d, zone, i))}
          />
        ))}
      </PivotZone>
    </div>
  );
}

/**
 * The Pivot and group by editor: the input's fields, and four zones (Filters and Columns on top, Rows and Values
 * below). Fields are dragged in, or added from their menu; a field in a zone is moved or reordered by dragging
 * or from its name's menu, and a value's aggregate is changed from its tag. A new Columns field, or new filters,
 * read its values again; Refresh columns does so on demand and says what changed.
 */
export function PivotEditor({
  params,
  errors,
  columns,
  readValues,
  onChange,
}: {
  params: Record<string, unknown>;
  errors: Record<string, string>;
  columns: ColumnSchema[];
  readValues?: ReadPivotValues;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const d = pivotDraft(params);
  const [reading, setReading] = useState(false);
  const [report, setReport] = useState<{ tone: 'info' | 'fail'; text: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  // Values arrive after the edit that asked for them; they go on the settings as they are by then.
  const latest = useRef(d);
  useEffect(() => {
    latest.current = d;
  });
  const reads = useRef(0);

  async function read(asked: PivotDraft, say: boolean) {
    if (!readValues || !asked.column) return;
    const n = ++reads.current;
    setReading(true);
    try {
      const got = await readValues({ column: asked.column, filters: asked.filters });
      const now = latest.current;
      if (n !== reads.current || now.column !== asked.column || JSON.stringify(now.filters) !== JSON.stringify(asked.filters)) return;
      setReport(say ? { tone: 'info', text: pivotValuesChange(now.pivotValues, got.values) } : null);
      if (JSON.stringify(got.values) !== JSON.stringify(now.pivotValues) || got.more !== now.moreValues) onChange({ ...now, pivotValues: got.values, moreValues: got.more });
    } catch (e) {
      if (n === reads.current) setReport({ tone: 'fail', text: `The values of ${asked.column} couldn’t be read. ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (n === reads.current) setReading(false);
    }
  }

  const commit = (next: PivotDraft) => {
    onChange({ ...next });
    if (valuesStale(d, next)) void read(next, false);
  };

  const outputs = pivotOutputs(d);
  const problems = ERROR_KEYS.map((k) => errors[k]).filter((e): e is string => !!e);

  return (
    <div className="flex flex-col gap-3" data-testid="pivot-editor">
      <Field label="Fields" hint="Drag a field into a zone, or open its menu. With Columns empty, this groups by Rows.">
        <div role="list" aria-label="Fields" className="flex flex-wrap gap-1">
          {columns.map((c) => (
            <div role="listitem" key={c.name}>
              <Menu
                align="start"
                label={c.name}
                items={ZONES.map((z) => ({ label: z.add, onSelect: () => commit(addToZone(d, c.name, z.zone, columns)) }))}
                renderTrigger={(t) => (
                  <button type="button" className="ui-chip font-mono" draggable onDragStart={startDrag({ column: c.name })} title={c.type} {...t}>
                    <TypeTag type={columnKind(c.type)} decorative />
                    {/* Named "Add region" from its text, so the name holds the words that are seen. */}
                    <span className="sr-only">Add</span> {c.name}
                  </button>
                )}
              />
            </div>
          ))}
          {!columns.length && <span className="text-ink-muted">No columns yet. Connect this node to a source.</span>}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        {ZONES.map((z) => (
          <ZoneBox key={z.zone} zone={z.zone} label={z.label} draft={d} columns={columns} commit={commit} />
        ))}
      </div>

      {problems.map((p) => (
        <p key={p} className="ui-field__hint is-error">
          {p}
        </p>
      ))}

      {d.column && (
        <div className="flex flex-col gap-2" data-testid="pivot-values">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-ink-muted">
              {reading
                ? `Reading the values of ${d.column}…`
                : d.pivotValues.length
                  ? `Columns for ${d.column}: ${shown(d.pivotValues)}.`
                  : `No values of ${d.column} read yet.`}
            </span>
            <Button size="sm" variant="ghost" icon="refresh" disabled={!readValues || reading} onClick={() => void read(d, true)}>
              Refresh columns
            </Button>
          </div>
          {report?.tone === 'info' && <p role="status">{report.text}</p>}
          {report?.tone === 'fail' && <Banner tone="fail">{report.text}</Banner>}
          {d.moreValues && (
            <Banner tone="warn" title="Too many values to make columns from">
              {d.column} has more than {d.pivotValues.length} values. Only the first {d.pivotValues.length} become columns: filter the rows first, or pivot on a column with fewer values.
            </Banner>
          )}
        </div>
      )}

      {d.filters.length > 0 && (
        <Field label="Filter rows before pivoting">
          <Conditions value={d.filters} columns={columns} onChange={(filters) => commit({ ...d, filters: filters as PivotDraft['filters'] })} />
        </Field>
      )}

      {outputs.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="ghost" icon={renaming ? 'chevron-up' : 'chevron-down'} aria-expanded={renaming} onClick={() => setRenaming((r) => !r)}>
            Rename columns ({outputs.length})
          </Button>
          {renaming &&
            outputs.map((o, i) => (
              <Field key={o.defaultName} label={o.defaultName} htmlFor={`pivot-name-${i}`}>
                <CommitInput key={o.name} id={`pivot-name-${i}`} mono value={o.name} onCommit={(v) => commit(renameOutput(d, o.defaultName, v))} />
              </Field>
            ))}
        </div>
      )}
    </div>
  );
}
