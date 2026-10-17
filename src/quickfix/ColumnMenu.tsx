import { useEffect, useState } from 'react';
import { REPLACE_MATCHES, type ReplaceMatch } from '../compiler';
import { useProject, useProjectStore, type ColumnSchema } from '../model';
import { holdsReplacement, replacementProblem } from '../steps';
import { ContextMenu, Dialog, Field, Select, Switch, TextInput, type MenuItem } from '../ui';
import { columnActions, type ColumnAction, type ColumnMenuContext } from './columnMenu';
import { make } from './fixes';
import { addStepWhereViewed, detectOnViewed } from './place';

/** Where the menu was asked for: the pointer, the columns it acts on and, from a cell, that cell's value. */
export interface ColumnMenuRequest {
  x: number;
  y: number;
  columns: string[];
  cell?: ColumnMenuContext['cell'];
}

/**
 * The column menu, opened by a right click on a results table header or cell (or the header's chevron): Power
 * Query's column operations, each adding one step where the viewed data is. Replace values asks what to replace first.
 */
export function ColumnMenu({ request, available, onClose }: { request: ColumnMenuRequest; available: ColumnSchema[]; onClose: () => void }) {
  const project = useProject();
  const viewed = project.view.viewedNodeId;
  const [replacing, setReplacing] = useState<{ find: string | null } | null>(null);
  // Picking Replace values closes the menu but not this component: its dialog takes the menu's place.
  const [menuClosed, setMenuClosed] = useState(false);
  useEffect(() => {
    if (menuClosed && !replacing) onClose();
  }, [menuClosed, replacing, onClose]);
  if (!viewed) return null;

  const ctx: ColumnMenuContext = { columns: request.columns, available, locale: project.settings.locale, detectDates: detectOnViewed(viewed), cell: request.cell };
  const asNodes = project.settings.stepsAsNodes;
  const entry = (a: ColumnAction): MenuItem => ({
    label: a.label,
    group: a.submenu ? undefined : a.group,
    onSelect: () => {
      if ('replace' in a) return setReplacing(a.replace);
      void Promise.resolve(a.step(ctx)).then(addStepWhereViewed);
    },
  });
  // Entries with a submenu are gathered into one item each, where the first of them stood.
  const items: MenuItem[] = [];
  for (const a of columnActions(ctx)) {
    if (!a.submenu) items.push(entry(a));
    else {
      const parent = items.find((i) => i.items && i.label === a.submenu);
      if (parent) parent.items!.push(entry(a));
      else items.push({ label: a.submenu, group: a.group, items: [entry(a)], onSelect: () => undefined });
    }
  }
  items.push({
    label: 'Add each step as a new node',
    group: 'Steps',
    checked: asNodes,
    toggle: true,
    onSelect: () => useProjectStore.getState().apply((p) => ({ ...p, settings: { ...p.settings, stepsAsNodes: !asNodes } })),
  });

  if (replacing) return <ReplaceValuesDialog ctx={ctx} find={replacing.find} onClose={onClose} />;
  const what = request.columns.length === 1 ? request.columns[0] : `${request.columns.length} columns`;
  return <ContextMenu x={request.x} y={request.y} label={`Actions for ${what}`} items={items} onClose={() => setMenuClosed(true)} />;
}

/** Replace values: what to find (a value, or empty values) and what goes in its place, for the menu's columns. */
function ReplaceValuesDialog({ ctx, find, onClose }: { ctx: ColumnMenuContext; find: string | null; onClose: () => void }) {
  const [match, setMatch] = useState<ReplaceMatch>(find == null ? 'null' : 'value');
  const [value, setValue] = useState(find ?? '');
  const [replace, setReplace] = useState(find == null ? 'empty' : '');
  const [toNull, setToNull] = useState(false);
  const picked = ctx.available.filter((c) => ctx.columns.includes(c.name));
  // Text when the replacement needs it, until the person sets it themselves.
  const [toTextSet, setToTextSet] = useState<boolean | undefined>();
  const toText = toTextSet ?? picked.some((c) => !holdsReplacement(c.type, replace));
  const params = { columns: ctx.columns, match, find: value, replace, replaceWithNull: toNull, matchCase: true, toText };
  const problem = replacementProblem(params, ctx.available);
  const ready = (match !== 'value' || value !== '') && !problem;
  return (
    <Dialog
      title={`Replace values in ${ctx.columns.join(', ')}`}
      confirm="Replace"
      confirmDisabled={!ready}
      onClose={onClose}
      onConfirm={() => {
        addStepWhereViewed(make('replaceValues', ctx, params));
        onClose();
      }}
    >
      <div className="flex flex-col gap-3" data-testid="replace-values">
        <Field label="Find" htmlFor="replace-match">
          <Select id="replace-match" options={Object.entries(REPLACE_MATCHES).map(([v, label]) => ({ value: v, label }))} value={match} onChange={(e) => setMatch(e.target.value as ReplaceMatch)} />
        </Field>
        {match === 'value' && (
          <Field label="Value to find" htmlFor="replace-find" hint="Whole values only. To change text inside values, use Find and replace.">
            <TextInput id="replace-find" mono value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        )}
        <Switch label="Replace with an empty value (null)" checked={toNull} onChange={setToNull} />
        {!toNull && (
          <>
            <Field label="Replace with" htmlFor="replace-with" error={problem}>
              <TextInput id="replace-with" mono data-autofocus value={replace} onChange={(e) => setReplace(e.target.value)} />
            </Field>
            <Switch label="Change to text" checked={toText} onChange={setToTextSet} />
          </>
        )}
      </div>
    </Dialog>
  );
}
