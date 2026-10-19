// The boxes the diagram asks for a value in: a name, type, default or note typed in place, and the popover that adds a
// ref after a column is dragged onto another.
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Select, Switch, TextInput } from '../../ui';
import { suggestOp, topInPane, type Ask, type PaneSpot } from './editing';
import type { ColumnRef, NewRef } from '../edit';
import { qualified, type DbmlSchema, type RefOp } from '../model';

const POP_GAP = 8;

/**
 * Where a popover sits so all of it shows in the pane: moved up after it is drawn if it would run past the bottom, and
 * no taller than the pane (scrolling inside instead), since a focused field in a taller box would scroll the pane itself.
 */
function useInPane(top: number) {
  const ref = useRef<HTMLFormElement>(null);
  const [place, setPlace] = useState<{ top: number; maxHeight?: number }>({ top });
  useLayoutEffect(() => {
    const el = ref.current;
    const pane = el?.offsetParent as HTMLElement | null;
    if (!el || !pane) return setPlace({ top });
    // Fractional sizes rounded outwards, so a pane of 366.4px never takes a popover reaching 366.6px.
    const height = Math.floor(pane.getBoundingClientRect().height);
    setPlace({ top: topInPane(top, Math.ceil(el.getBoundingClientRect().height), height), maxHeight: Math.max(0, height - 2 * POP_GAP) });
  }, [top]);
  // The field focused on opening may have scrolled the pane, which only clips and never scrolls; put it back.
  useLayoutEffect(() => {
    const pane = ref.current?.offsetParent as HTMLElement | null;
    pane?.scrollTo({ top: 0 });
  }, [place]);
  return [ref, place] as const;
}

const LABEL: Record<Ask['kind'], string> = {
  'rename-table': 'Table name',
  'rename-column': 'Column name',
  type: 'Column type',
  default: 'Default value',
  note: 'Table note',
  'new-column': 'New column: name and type',
  'new-group': 'New group name',
};

const HINT: Partial<Record<Ask['kind'], string>> = {
  default: "A number, true, false, null, 'text' or `expression`. Empty for none.",
  'new-column': 'For example: email varchar(255)',
  note: 'Empty removes the note.',
};

/** The box a name, type, default or note is typed into: Enter keeps it, Escape leaves it as it was. */
export function AskBox({ ask, onDone }: { ask: Ask; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(ask.value);
  const [ref, place] = useInPane(ask.at.top);
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onDone(value);
  };
  return (
    <form ref={ref} className="ui-popover puddle-schema-ask" style={{ left: ask.at.left, ...place, overflowY: 'auto', minWidth: ask.at.width }} onSubmit={submit} data-testid="schema-ask">
      <label className="text-label text-ink-muted" htmlFor={id}>
        {LABEL[ask.kind]}
      </label>
      <TextInput
        id={id}
        autoFocus
        mono={ask.kind !== 'note' && ask.kind !== 'new-group'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone(null);
          }
        }}
        onBlur={() => onDone(value)}
      />
      {HINT[ask.kind] && <p className="text-label text-ink-muted">{HINT[ask.kind]}</p>}
    </form>
  );
}

const OPS: { value: RefOp; label: string }[] = [
  { value: '>', label: 'Many to one (>)' },
  { value: '<', label: 'One to many (<)' },
  { value: '-', label: 'One to one (-)' },
  { value: '<>', label: 'Many to many (<>)' },
];

const endText = (c: ColumnRef) => `${qualified(c.schema, c.table)}.${c.column}`;

/** After a column is dropped on another: what kind of ref, and whether either end may have no match. */
export function RefAsk({ schema, from, to, at, onAdd, onCancel }: { schema: DbmlSchema; from: ColumnRef; to: ColumnRef; at: PaneSpot; onAdd: (ref: NewRef) => void; onCancel: () => void }) {
  const [op, setOp] = useState<RefOp>(() => suggestOp(schema, from, to));
  const [fromOptional, setFromOptional] = useState(false);
  const [toOptional, setToOptional] = useState(false);
  const [ref, place] = useInPane(at.top);
  const id = useId();
  return (
    <form
      ref={ref}
      className="ui-popover puddle-schema-ask"
      style={{ left: at.left, ...place, overflowY: 'auto' }}
      data-testid="schema-ref-ask"
      aria-label="Add a ref"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ from, to, op, fromOptional, toOptional });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="ui-popover__head">
        <span className="puddle-schema-pop__name">
          {endText(from)} to {endText(to)}
        </span>
      </div>
      <label className="text-label text-ink-muted" htmlFor={id}>
        Kind of ref
      </label>
      <Select id={id} autoFocus options={OPS} value={op} onChange={(e) => setOp(e.target.value as RefOp)} />
      <Switch label={`${from.column} may have no match`} checked={fromOptional} onChange={setFromOptional} />
      <Switch label={`${to.column} may have no match`} checked={toOptional} onChange={setToOptional} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          Add ref
        </Button>
      </div>
    </form>
  );
}

