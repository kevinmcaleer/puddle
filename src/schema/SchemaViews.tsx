// The strip above the diagram: a tab for All tables and each view, the open view's actions and its Add tables list,
// a New view button that starts from the selected tables, and the detail level.
import { useState } from 'react';
import { useProjectStore, type Detail, type Project } from '../model';
import { Button, Menu, Select, Tabs, TextInput } from '../ui';
import { tableId } from './diagram/geometry';
import type { DbmlSchema } from './model';
import { qualified } from './model';
import { addSchemaView, addToSchemaView, currentView, deleteSchemaView, duplicateSchemaView, openSchemaView, renameSchemaView, setSchemaDetail } from './views';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

export const ALL_TABLES = 'all';

const DETAILS: { value: Detail; label: string; title: string }[] = [
  { value: 'full', label: 'Full', title: 'Every column' },
  {
    value: 'keys',
    label: 'Keys',
    title: 'Primary keys, unique columns and columns in a ref',
  },
  { value: 'names', label: 'Names', title: 'Table names only' },
];

export function SchemaViews({ project, schema, selected }: { project: Project; schema: DbmlSchema; selected: string[] }) {
  const doc = project.schema;
  const view = currentView(doc);
  const [renaming, setRenaming] = useState<string | null>(null);
  const detail = view?.detail ?? doc.detail;
  const missing = view ? schema.tables.filter((t) => !view.tables.includes(tableId(t))) : [];

  const tabs = [
    { id: ALL_TABLES, label: 'All tables', count: schema.tables.length },
    ...doc.views.map((v) => ({
      id: v.id,
      label: v.name,
      count: v.tables.filter((t) => schema.tables.some((x) => tableId(x) === t)).length,
    })),
  ];

  return (
    <div className="puddle-schema-views" role="toolbar" aria-label="Diagram views" data-testid="schema-views">
      <Tabs label="Views" items={tabs} value={view?.id ?? ALL_TABLES} onChange={(id) => apply((p) => openSchemaView(p, id === ALL_TABLES ? undefined : id))} />
      {view && renaming === view.id ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get('name');
            setRenaming(null);
            if (typeof name === 'string') apply((p) => renameSchemaView(p, view.id, name));
          }}
        >
          <TextInput
            name="name"
            aria-label="View name"
            autoFocus
            defaultValue={view.name}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setRenaming(null);
              }
            }}
          />
        </form>
      ) : (
        view && (
          <Menu
            label={`Actions for ${view.name}`}
            button={{
              size: 'sm',
              variant: 'ghost',
              icon: 'more',
              iconOnly: true,
              'aria-label': `Actions for ${view.name}`,
            }}
            align="start"
            items={[
              {
                label: 'Rename…',
                icon: 'text',
                onSelect: () => setRenaming(view.id),
              },
              {
                label: 'Duplicate',
                onSelect: () => apply((p) => duplicateSchemaView(p, view.id).project),
              },
              {
                label: 'Delete view',
                icon: 'cross',
                group: 'Delete',
                onSelect: () => apply((p) => deleteSchemaView(p, view.id)),
              },
            ]}
          />
        )
      )}
      <Button
        size="sm"
        variant="ghost"
        icon="plus"
        title={selected.length ? `A view of the ${selected.length} selected tables` : 'An empty view; add tables to it from its list. Shift+click tables first to start from them.'}
        onClick={() => apply((p) => addSchemaView(p, selected).project)}
        data-testid="schema-new-view"
      >
        {selected.length ? `New view of ${selected.length}` : 'New view'}
      </Button>
      {view && missing.length > 0 && (
        <Select
          aria-label="Add tables"
          data-testid="schema-view-add"
          value=""
          options={[
            { value: '', label: 'Add tables…' },
            ...(missing.length > 1 ? [{ value: '*', label: `Every other table (${missing.length})` }] : []),
            ...missing.map((t) => ({
              value: tableId(t),
              label: qualified(t.schema, t.name),
            })),
          ]}
          onChange={(e) => {
            const v = e.target.value;
            if (v) apply((p) => addToSchemaView(p, view.id, v === '*' ? missing.map(tableId) : [v]));
          }}
        />
      )}
      <span className="flex-1" />
      <div className="puddle-schema-detail" role="group" aria-label="Detail">
        {DETAILS.map((d) => (
          <Button
            key={d.value}
            size="sm"
            variant={detail === d.value ? 'secondary' : 'ghost'}
            aria-pressed={detail === d.value}
            title={d.title}
            onClick={() => apply((p) => setSchemaDetail(p, d.value))}
          >
            {d.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
