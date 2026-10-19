// Editing the schema on its diagram, without the DOM: the edit each typed answer makes, the likely kind of a dragged
// ref, and the menus on a table and a column. Each change is a text edit (src/schema/edit.ts), so the DBML stays the one
// source and the editor shows the change.
import type { MenuItem } from '../../ui';
import {
  addColumn,
  createGroup,
  defaultText,
  deleteColumn,
  deleteTable,
  moveToGroup,
  parseDefault,
  parseNewColumn,
  renameColumn,
  renameTable,
  setTableColor,
  setTableNote,
  updateColumn,
  type ColumnRef,
  type TableRef,
} from '../edit';
import type { DbmlSchema, RefOp, Table } from '../model';
import { tableId } from './geometry';
import { TONE_HEX, TONES, toneOf } from './palette';

/**
 * What else a change to the text moves: a renamed table's place (old and new diagram ids), new elements' places, and a
 * deleted table's (by diagram id), in every view.
 */
export interface EditPlaces {
  renamed?: { from: string; to: string };
  places?: Record<string, { x: number; y: number }>;
  deleted?: string;
}

/** A change to the DBML text, made as one undo step with the places it moves. */
export type DiagramEdit = (change: (dbml: string) => string, also?: EditPlaces) => void;

/** Where a box or popover sits in the pane. */
export interface PaneSpot {
  left: number;
  top: number;
  width?: number;
}

/** What is being typed, and where. */
export interface Ask {
  kind: 'rename-table' | 'rename-column' | 'type' | 'default' | 'note' | 'new-column' | 'new-group';
  table: TableRef;
  column?: string;
  /** For a new group: every table going into it. */
  tables?: TableRef[];
  at: PaneSpot;
  value: string;
}

export const tableRef = (t: Pick<Table, 'schema' | 'name'>): TableRef => ({ schema: t.schema, table: t.name });

/** The edit an answer makes, or undefined when it changes nothing. */
export function answer(ask: Ask, value: string): { change: (dbml: string) => string; renamed?: { from: string; to: string } } | undefined {
  const v = value.trim();
  const col: ColumnRef | undefined = ask.column != null ? { ...ask.table, column: ask.column } : undefined;
  switch (ask.kind) {
    case 'rename-table':
      if (!v || v === ask.table.table) return undefined;
      return { change: (d) => renameTable(d, ask.table, v), renamed: { from: tableId({ schema: ask.table.schema, name: ask.table.table }), to: tableId({ schema: ask.table.schema, name: v }) } };
    case 'rename-column':
      return v && v !== ask.column ? { change: (d) => renameColumn(d, col!, v) } : undefined;
    case 'type':
      return v && v !== ask.value ? { change: (d) => updateColumn(d, col!, { type: v }) } : undefined;
    case 'default':
      return v === ask.value.trim() ? undefined : { change: (d) => updateColumn(d, col!, { default: parseDefault(v) }) };
    case 'note':
      return v === ask.value.trim() ? undefined : { change: (d) => setTableNote(d, ask.table, v || undefined) };
    case 'new-column': {
      const c = parseNewColumn(v);
      return c ? { change: (d) => addColumn(d, ask.table, c, ask.column) } : undefined;
    }
    case 'new-group':
      return v ? { change: (d) => createGroup(d, v, ask.tables ?? [ask.table]) } : undefined;
  }
}

/** The likely kind of ref between two columns: many to one onto a key, one to many from one, else many to one. */
export function suggestOp(schema: DbmlSchema, from: ColumnRef, to: ColumnRef): RefOp {
  const isKey = (c: ColumnRef) => {
    const t = schema.tables.find((x) => x.schema === c.schema && x.name === c.table);
    const col = t?.columns.find((x) => x.name === c.column);
    return !!col && (col.pk || col.unique);
  };
  const [a, b] = [isKey(from), isKey(to)];
  if (a && b) return '-';
  if (a && !b) return '<';
  return '>';
}

const TONE_NAME: Record<(typeof TONES)[number], string> = { teal: 'Teal', blue: 'Blue', purple: 'Purple', amber: 'Amber', red: 'Red', grey: 'Grey' };

/**
 * A table's right-click menu. `ask` opens a box at the table; `selection` is every table selected with it; `hide`, in
 * a view, takes the table (and the others selected) out of the view.
 */
export function tableMenu(
  schema: DbmlSchema,
  table: Table,
  edit: DiagramEdit,
  ask: (kind: Ask['kind'], value: string, extra?: Partial<Ask>) => void,
  selection: TableRef[],
  hide?: () => void,
): MenuItem[] {
  const ref = tableRef(table);
  const tone = table.headerColor ? toneOf(table.headerColor) : undefined;
  const group = schema.groups.find((g) => g.tables.some((t) => t.schema === table.schema && t.name === table.name));
  const others = selection.filter((t) => !(t.schema === ref.schema && t.table === ref.table));
  return [
    { label: 'Rename…', icon: 'text', shortcut: 'F2', onSelect: () => ask('rename-table', table.name) },
    { label: 'Add column…', icon: 'plus', onSelect: () => ask('new-column', '') },
    { label: table.note ? 'Edit note…' : 'Add note…', icon: 'notes', onSelect: () => ask('note', table.note ?? '') },
    {
      label: 'Header colour',
      items: [
        ...TONES.map((t) => ({ label: TONE_NAME[t], group: 'Colour', checked: tone === t, onSelect: () => edit((d) => setTableColor(d, ref, TONE_HEX[t])) })),
        { label: 'No colour', checked: !table.headerColor, group: 'Colour', onSelect: () => edit((d) => setTableColor(d, ref, undefined)) },
      ],
      onSelect: () => undefined,
    },
    {
      label: 'Group',
      items: [
        ...schema.groups.map((g) => ({ label: g.name, group: 'Move into', checked: g === group, onSelect: () => edit((d) => moveToGroup(d, ref, g.name)) })),
        ...(group ? [{ label: `Out of ${group.name}`, onSelect: () => edit((d) => moveToGroup(d, ref, undefined)) }] : []),
        { label: others.length ? `New group with ${others.length + 1} tables…` : 'New group…', onSelect: () => ask('new-group', '', { tables: [ref, ...others] }) },
      ],
      onSelect: () => undefined,
    },
    ...(hide ? [{ label: others.length ? `Hide ${others.length + 1} tables from view` : 'Hide from view', icon: 'eye' as const, group: 'View', onSelect: hide }] : []),
    { label: 'Delete table', icon: 'cross', group: 'Delete', onSelect: () => edit((d) => deleteTable(d, ref), { deleted: tableId(table) }) },
  ];
}

/** A column's right-click menu. */
export function columnMenu(table: Table, column: string, edit: DiagramEdit, ask: (kind: Ask['kind'], value: string, extra?: Partial<Ask>) => void): MenuItem[] {
  const c = table.columns.find((x) => x.name === column);
  if (!c) return [];
  const ref: ColumnRef = { ...tableRef(table), column };
  // A column from a TablePartial is changed in the partial, in the editor.
  if (c.partial) return [{ label: `From the partial ${c.partial}: edit it in the DBML`, disabled: true, onSelect: () => undefined }];
  const flag = (label: string, key: 'pk' | 'unique' | 'increment') => ({ label, group: 'Settings', toggle: true, checked: c[key], onSelect: () => edit((d) => updateColumn(d, ref, { [key]: !c[key] })) });
  return [
    { label: 'Rename…', icon: 'text', shortcut: 'F2', onSelect: () => ask('rename-column', column, { column }) },
    { label: 'Type…', onSelect: () => ask('type', c.type, { column }) },
    { label: 'Default…', onSelect: () => ask('default', defaultText(c.default), { column }) },
    { label: 'Add column after…', icon: 'plus', onSelect: () => ask('new-column', '', { column }) },
    flag('Primary key', 'pk'),
    flag('Unique', 'unique'),
    { label: 'Not null', group: 'Settings', toggle: true, checked: !!c.notNull, onSelect: () => edit((d) => updateColumn(d, ref, { notNull: c.notNull ? undefined : true })) },
    flag('Increment', 'increment'),
    { label: 'Delete column', icon: 'cross', group: 'Delete', onSelect: () => edit((d) => deleteColumn(d, ref)) },
  ];
}
