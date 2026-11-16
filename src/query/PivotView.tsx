import { useState, type DragEvent, type ReactNode } from 'react';
import { useEngineStore } from '../app/engine';
import { CRITERIA_OPS, MAX_PIVOT_COLUMNS, TOTALS } from '../compiler';
import {
  addQueryField,
  newId,
  removeQueryField,
  setQueryCriteria,
  setQuerySpec,
  updateQueryField,
  useProjectStore,
  type Project,
  type QueryCriteriaOp,
  type QueryField,
  type QueryNode,
  type QueryTotal,
} from '../model';
import { CommitInput } from '../steps/CommitInput';
import { announce, Banner, Button, columnKind, cx, Select, TypeTag } from '../ui';
import { readPivotValues } from './pivotValues';
import { landing, wellOf, type PivotWell } from './pivotWells';
import type { DesignerTable } from './tables';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/** A field dragged from the list, as text so it survives the browser's drag data. */
const PIVOT_MIME = 'application/x-puddle-pivot-field';

const WELLS: Record<PivotWell, { label: string; hint: string }> = {
  rows: { label: 'Rows', hint: 'One row for each value, or each mix of values, of these fields.' },
  columns: { label: 'Columns', hint: 'One column for each value of this field, under every summary.' },
  values: { label: 'Values', hint: 'What is summarised in each cell: a sum, a count, an average.' },
  filters: { label: 'Filters', hint: 'Rows are left out before anything is counted.' },
};

/** The summaries Values offers, in the grid's order. */
const SUMMARIES = (Object.keys(TOTALS) as QueryTotal[]).filter((t) => TOTALS[t].sql);
const CRITERIA_OPTIONS = (Object.keys(CRITERIA_OPS) as QueryCriteriaOp[]).map((op) => ({ value: op, label: CRITERIA_OPS[op].label }));

/**
 * The Pivot view of a Query: its tables' fields on the left, and four wells to put them in (Rows, Columns, Values and
 * Filters). It is another face of the design grid, with the Totals row on: Rows are its Group by fields, Values its
 * summaries, Filters its Where fields, and Columns its Pivot columns field. The tables are joined by the query's
 * join lines, which the project's relationships draw as each table is added.
 */
export function PivotView({ node, tables }: { node: QueryNode; tables: DesignerTable[] }) {
  const engine = useEngineStore((s) => s.engine);
  const spec = node.querySpec;
  const [reading, setReading] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState<PivotWell | null>(null);
  const labelOf = (port: number) => tables.find((t) => t.port === port)?.label ?? `input ${port + 1}`;
  const columnOf = (port: number, column: string) => tables.find((t) => t.port === port)?.columns?.find((c) => c.name === column);
  // A field's name here: its column, with its table when two tables have a column of that name.
  const nameOf = (f: Pick<QueryField, 'port' | 'column'>) => (tables.filter((t) => t.columns?.some((c) => c.name === f.column)).length > 1 ? `${labelOf(f.port)}.${f.column}` : f.column);
  const inWell = (well: PivotWell) => spec.fields.filter((f) => wellOf(f) === well);
  const options = tables.flatMap((t) => (t.columns ?? []).map((c) => ({ value: `${t.port}\u0000${c.name}`, label: tables.length > 1 ? `${t.label}.${c.name}` : c.name })));

  /** Read the values a Columns field turns into columns, and keep them in the design. */
  const readValues = async (fieldId: string, from: Project = useProjectStore.getState().history.present) => {
    if (!engine) return;
    setReading(fieldId);
    setProblem(null);
    try {
      const values = await readPivotValues(engine, from, node.id, fieldId);
      apply((p) => updateQueryField(p, node.id, fieldId, { pivotValues: values }));
      announce(values.length === 1 ? '1 value became a column' : `${values.length} values became columns`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(null);
    }
  };

  const add = (well: PivotWell, port: number, column: string) => {
    const id = newId('f');
    apply((p) => {
      let next = p;
      // Columns holds one field: another takes its place.
      if (well === 'columns') for (const f of inWell('columns')) next = removeQueryField(next, node.id, f.id);
      next = addQueryField(next, node.id, { port, column }, undefined, id);
      next = updateQueryField(next, node.id, id, landing(well, columnOf(port, column)));
      // A filter that keeps everything with a value is a filter at once; narrow it from there.
      if (well === 'filters') next = setQueryCriteria(next, node.id, id, 0, { op: 'notEmpty', value: '' });
      return setQuerySpec(next, node.id, { totals: true });
    });
    announce(`${column} added to ${WELLS[well].label}`);
    if (well === 'columns') void readValues(id);
  };

  const drop = (well: PivotWell) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const [port, column] = e.dataTransfer.getData(PIVOT_MIME).split('\u0000');
    if (column) add(well, Number(port), column);
  };

  const chip = (f: QueryField, body?: ReactNode) => (
    <li key={f.id} className="puddle-qd-chip" data-testid={`pivot-field-${nameOf(f)}`}>
      <span className="ui-col min-w-0 truncate" title={`${labelOf(f.port)}.${f.column}`}>{nameOf(f)}</span>
      {body}
      <Button variant="ghost" size="sm" iconOnly icon="cross" aria-label={`Remove ${nameOf(f)}`} onClick={() => apply((p) => removeQueryField(p, node.id, f.id))} />
    </li>
  );

  const body = (well: PivotWell, f: QueryField): ReactNode => {
    if (well === 'values')
      return f.total === 'expression' ? (
        <span className="text-label text-ink-muted">Expression</span>
      ) : (
        <Select
          aria-label={`Summary of ${nameOf(f)}`}
          options={SUMMARIES.map((t) => ({ value: t, label: TOTALS[t].label }))}
          value={f.total ?? 'sum'}
          onChange={(e) => apply((p) => updateQueryField(p, node.id, f.id, { total: e.target.value as QueryTotal }))}
        />
      );
    if (well === 'columns')
      return (
        <>
          <span className="text-label text-ink-muted" data-testid="pivot-values-count">
            {reading === f.id ? 'Reading values' : `${f.pivotValues?.length ?? 0} ${f.pivotValues?.length === 1 ? 'value' : 'values'}`}
          </span>
          <Button variant="ghost" size="sm" icon="refresh" disabled={!engine || reading === f.id} title="Read its values again: new ones become columns, and ones no longer there go" onClick={() => void readValues(f.id)}>
            Read values
          </Button>
        </>
      );
    if (well === 'filters') {
      const c = f.criteria ?? { op: 'notEmpty' as const, value: '' };
      return (
        <>
          <Select aria-label={`Condition on ${nameOf(f)}`} options={CRITERIA_OPTIONS} value={c.op} onChange={(e) => apply((p) => setQueryCriteria(p, node.id, f.id, 0, { op: e.target.value as QueryCriteriaOp, value: c.value }))} />
          {CRITERIA_OPS[c.op].needsValue && <CommitInput key={c.value} aria-label={`Value for ${nameOf(f)}`} value={c.value} onCommit={(v) => apply((p) => setQueryCriteria(p, node.id, f.id, 0, { op: c.op, value: v }))} />}
        </>
      );
    }
    return undefined;
  };

  return (
    <div className="puddle-qd-pivot" data-testid="query-pivot">
      <aside className="puddle-qd-pivot__fields" aria-label="Fields">
        {tables.map((t) => (
          <section key={t.port}>
            <h3 className="ui-eyebrow">{t.label}</h3>
            {!t.columns && <p className="text-label text-ink-muted">{t.problem ?? 'Reading its columns.'}</p>}
            <ul>
              {(t.columns ?? []).map((c) => (
                <li
                  key={c.name}
                  draggable
                  className="puddle-qd-pivot__field"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PIVOT_MIME, `${t.port}\u0000${c.name}`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <TypeTag type={columnKind(c.type)} decorative />
                  <span className="ui-col truncate">{c.name}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!tables.length && <p className="text-label text-ink-muted">Add a table to pick its fields.</p>}
      </aside>
      <div className="puddle-qd-pivot__wells">
        {!spec.totals && spec.fields.length > 0 && (
          <Banner tone="info">This design lists its rows as they are. Putting a field in a well here turns on Totals, which groups the rows by the fields in Rows.</Banner>
        )}
        {problem && (
          <Banner tone="warn" action={<Button variant="ghost" size="sm" onClick={() => setProblem(null)}>Dismiss</Button>}>
            {problem}
          </Banner>
        )}
        {(Object.keys(WELLS) as PivotWell[]).map((well) => (
          <section
            key={well}
            className={cx('puddle-qd-well', over === well && 'is-over')}
            data-testid={`pivot-${well}`}
            aria-label={WELLS[well].label}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(PIVOT_MIME)) return;
              e.preventDefault();
              setOver(well);
            }}
            onDragLeave={() => setOver((o) => (o === well ? null : o))}
            onDrop={drop(well)}
          >
            <div className="puddle-qd-well__head">
              <h3 className="text-body-strong text-ink">{WELLS[well].label}</h3>
              <p className="text-label text-ink-muted">{WELLS[well].hint}</p>
            </div>
            <ul className="puddle-qd-well__fields">{inWell(well).map((f) => chip(f, body(well, f)))}</ul>
            <Select
              aria-label={`Add a field to ${WELLS[well].label}`}
              options={[{ value: '', label: inWell(well).length && well === 'columns' ? 'Change the field…' : 'Add a field…' }, ...options]}
              value=""
              disabled={!options.length}
              onChange={(e) => {
                const [port, column] = e.target.value.split('\u0000');
                if (column) add(well, Number(port), column);
              }}
            />
          </section>
        ))}
        <p className="text-label text-ink-muted">
          Drag a field into a well, or pick it from the well’s list. Tables are joined by the query’s join lines, which the project’s relationships draw as each table is added. A Columns field can give up to {MAX_PIVOT_COLUMNS} columns.
        </p>
      </div>
    </div>
  );
}
