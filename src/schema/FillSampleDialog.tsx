// Fill with sample data on the Schema view: rows that keep the design (types, keys, enums, checks and refs, parents
// first) for the chosen tables, written into the DBML as records so they load into the tables and travel with the
// project. Off Keep as records, they are example records: shown and loaded, left out of SQL exports.
import { useMemo, useState } from 'react';
import { Banner, Dialog, Field, Switch, TextInput } from '../ui';
import { qualified, type DbmlSchema } from './model';
import { fillRecords, generateRows } from './sample';

const MAX_ROWS = 10_000;

/** "a, b and c" */
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export function FillSampleDialog({ dbml, schema, tables, onClose, onFill }: { dbml: string; schema: DbmlSchema; tables: string[]; onClose: () => void; onFill: (dbml: string, tables: string[]) => void }) {
  const [rowsText, setRowsText] = useState('100');
  const [seedText, setSeedText] = useState('1');
  const [keep, setKeep] = useState(true);
  const rows = Number(rowsText);
  const seed = Number(seedText);
  const rowsError = !Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS ? `A whole number from 1 to ${MAX_ROWS.toLocaleString('en')}.` : undefined;
  const seedError = !Number.isInteger(seed) ? 'A whole number.' : undefined;
  const generated = useMemo(() => (rowsError || seedError ? null : generateRows(schema, tables, { rows, seed })), [schema, tables, rows, seed, rowsError, seedError]);
  const names = (ids: string[]) => listed(ids.map((id) => schema.tables.find((t) => `table:${t.schema}.${t.name}` === id)).filter((t) => !!t).map((t) => qualified(t.schema, t.name)));
  return (
    <Dialog
      title="Fill with sample data"
      confirm="Fill"
      confirmDisabled={!generated}
      onClose={onClose}
      onConfirm={() => {
        if (!generated) return;
        onFill(fillRecords(dbml, schema, generated.tables, { example: !keep }), generated.tables.map((t) => `table:${t.schema}.${t.table}`));
        onClose();
      }}
      className="w-[480px] max-w-[calc(100vw-32px)]"
    >
      <p className="text-label text-ink-muted" data-testid="fill-sample-tables">
        Rows for {names(tables)}
        {generated?.added.length ? `, and for ${names(generated.added)}, which they refer to and which have no rows yet` : ''}. They keep the design: types, keys, enums, checks and refs.
      </p>
      <Field label="Rows per table" htmlFor="fill-sample-rows" error={rowsError}>
        <TextInput id="fill-sample-rows" inputMode="numeric" value={rowsText} onChange={(e) => setRowsText(e.target.value)} data-autofocus />
      </Field>
      <Field label="Seed" htmlFor="fill-sample-seed" error={seedError} hint="The same seed gives the same rows.">
        <TextInput id="fill-sample-seed" inputMode="numeric" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
      </Field>
      <Switch id="fill-sample-keep" label="Keep as records" checked={keep} onChange={setKeep} />
      <p className="text-label text-ink-muted">
        {keep ? 'Written into the DBML as records: they load into the tables and export as INSERTs.' : 'Written as example records: they load into the tables but stay out of SQL exports.'}
      </p>
      {!!generated?.notes.length && (
        <div data-testid="fill-sample-notes">
          <Banner tone="warn">
            {generated.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Banner>
        </div>
      )}
    </Dialog>
  );
}
