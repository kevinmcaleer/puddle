import { useEffect, useState, type KeyboardEvent } from 'react';
import { useFlowStore } from '../flow/status';
import { useStepColumns } from '../inspector/useStepColumns';
import { inputEdges, nodeById, useProject, type ColumnSchema, type TransformNode } from '../model';
import { Banner, Button, columnKind, Dialog, Field, FieldChip, Select, StepList, Switch, TextInput } from '../ui';
import { insertFeed, insertTemplateAfter, openTemplateDialog, saveAsTemplate, useTemplateDialog } from './actions';
import { editTemplate, refreshTemplates, removeTemplate, useTemplates } from './library';
import { expectedColumns, missingColumns, suggestedMapping } from './mapping';
import { notTemplatable, searchTemplates, type Template } from './template';

const close = () => openTemplateDialog(null);

/** Enter in a field that isn't the dialog's own does `then` instead of confirming the dialog. */
const onEnter = (then: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  then();
};

/** Expected columns as field chips, with their types. */
function Columns({ columns, testId }: { columns: ColumnSchema[]; testId?: string }) {
  if (!columns.length) return <p className="text-label text-ink-muted">Reads no input columns by name.</p>;
  return (
    <div className="flex flex-wrap gap-1" data-testid={testId}>
      {columns.map((c) => (
        <FieldChip key={c.name} name={c.name} type={columnKind(c.type)} onRemove={false} draggable={false} />
      ))}
    </div>
  );
}

/** Save a Transform node's steps, all of them or some, as a template. */
function SaveDialog({ node }: { node: TransformNode }) {
  const project = useProject();
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState(() => new Set(node.steps.filter((s) => !notTemplatable(s)).map((s) => s.id)));
  const steps = node.steps.filter((s) => picked.has(s.id));
  const first = node.steps.findIndex((s) => picked.has(s.id));
  // The columns arriving at the first picked step are what the template's steps start from.
  const input = useStepColumns(project, node.id, Math.max(0, first));
  const wired = inputEdges(project, node.id).length > 0;
  const expected = expectedColumns(steps, input);
  const ready = steps.length > 0 && input.length > 0 && name.trim() !== '';
  return (
    <Dialog
      title="Save as template"
      confirm="Save template"
      confirmDisabled={!ready}
      onClose={close}
      onConfirm={() => {
        close();
        void saveAsTemplate({ name, description, steps, expectedColumns: expected });
      }}
      className="w-[560px] max-w-[calc(100vw-32px)]"
    >
      <p className="text-label text-ink-muted">A template keeps the steps and the columns they expect, never data or sources. Every project in this browser can use it.</p>
      <Field label="Name" htmlFor="template-name">
        <TextInput id="template-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="template-description">
        <textarea id="template-description" className="ui-input min-h-[var(--size-row)] w-full resize-y py-1" rows={2} value={description} placeholder="What it cleans, and what it expects." onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex flex-col gap-1" role="group" aria-label="Steps">
        <span className="ui-eyebrow">Steps</span>
        {node.steps.map((s) => {
          const reason = notTemplatable(s);
          return (
            <div key={s.id} title={reason}>
              <Switch
                label={reason ? `${s.label} (can’t go in a template)` : s.label}
                checked={picked.has(s.id)}
                onChange={(on) => {
                  if (reason) return;
                  const next = new Set(picked);
                  if (on) next.add(s.id);
                  else next.delete(s.id);
                  setPicked(next);
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1">
        <span className="ui-eyebrow">Expects these columns</span>
        {!steps.length ? (
          <p className="text-label text-ink-muted">Pick at least one step.</p>
        ) : !wired ? (
          <Banner tone="warn">Wire the node to an input first, so the template knows which columns its steps expect.</Banner>
        ) : !input.length ? (
          <p className="text-label text-ink-muted">Reading the input’s columns…</p>
        ) : (
          <Columns columns={expected} testId="template-expected" />
        )}
      </div>
    </Dialog>
  );
}

/** Rename, describe or delete a template in the library. */
function Manage({ template }: { template: Template }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const save = () => {
    setEditing(false);
    void editTemplate(template.id, { name, description });
  };
  if (editing)
    return (
      <div className="flex flex-col gap-2">
        <Field label="Template name" htmlFor="template-rename">
          <TextInput id="template-rename" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(save)} />
        </Field>
        <Field label="Template description" htmlFor="template-redescribe">
          <textarea id="template-redescribe" className="ui-input min-h-[var(--size-row)] w-full resize-y py-1" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={save}>
            Save changes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" icon="text" onClick={() => setEditing(true)}>
        Rename or describe
      </Button>
      {deleting ? (
        <>
          <Button size="sm" variant="danger" onClick={() => void removeTemplate(template.id)}>
            Delete template
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>
            Keep it
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" icon="cross" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}
    </div>
  );
}

/** For each expected column the input lacks, a pick list of the input's columns to use in its place. */
function Mapping({ template, actual, mapping, onChange }: { template: Template; actual: ColumnSchema[]; mapping: Record<string, string | undefined>; onChange: (expected: string, column: string) => void }) {
  const missing = missingColumns(template.expectedColumns, actual);
  if (!missing.length) return <p className="text-label text-ink-muted">The input has every column this template expects.</p>;
  const unmapped = missing.filter((m) => !mapping[m.expected.name]).length;
  return (
    <div className="flex flex-col gap-2" data-testid="template-mapping">
      <Banner tone="warn" title={`${missing.length} ${missing.length === 1 ? 'column isn’t' : 'columns aren’t'} in the input`}>
        Pick a column to use in place of each. {unmapped ? 'Steps that read an unmapped column arrive turned off.' : 'Every one is mapped.'}
      </Banner>
      {missing.map((m) => (
        <Field key={m.expected.name} label={`Use for ${m.expected.name}`} htmlFor={`map-${m.expected.name}`}>
          <Select
            id={`map-${m.expected.name}`}
            value={mapping[m.expected.name] ?? ''}
            options={[{ value: '', label: 'Leave unmapped' }, ...actual.map((a) => ({ value: a.name, label: a.name }))]}
            onChange={(e) => onChange(m.expected.name, e.target.value)}
          />
        </Field>
      ))}
    </div>
  );
}

/** The templates library: search, preview, map the input's columns and insert; rename, describe and delete. */
function LibraryDialog() {
  const templates = useTemplates((s) => s.templates);
  const unreadable = useTemplates((s) => s.unreadable);
  const [query, setQuery] = useState('');
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Picks made in the mapping, '' for Leave unmapped; columns not picked yet take their suggestion.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [feed] = useState(insertFeed);
  const project = useProject();
  const feedNode = feed ? nodeById(project, feed) : undefined;
  const status = useFlowStore((s) => (feed ? s.nodes[feed]?.status : undefined));
  const actual = status?.state === 'ok' ? status.columns : undefined;
  // A feed still being read holds the insert back; one that can't be read lets it go in with its steps as saved.
  const reading = !!feed && (!status || status.state === 'pending');
  useEffect(() => void refreshTemplates().catch(() => undefined), []);
  const shown = searchTemplates(templates, query);
  const chosen = templates.find((t) => t.id === chosenId);
  const choose = (t: Template) => {
    setChosenId(t.id);
    setPicks({});
  };
  const suggested = chosen && actual ? suggestedMapping(chosen.expectedColumns, actual) : {};
  const mapping: Record<string, string | undefined> = { ...suggested, ...Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, v || undefined])) };
  return (
    <Dialog
      title="Templates"
      confirm="Insert template"
      confirmDisabled={!chosen || reading}
      onClose={close}
      onConfirm={() => {
        if (!chosen) return;
        close();
        insertTemplateAfter(chosen, feed, actual, mapping);
      }}
      className="w-[640px] max-w-[calc(100vw-32px)]"
    >
      <input className="ui-input" aria-label="Search templates" placeholder="Search templates" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} onKeyDown={onEnter(() => shown[0] && choose(shown[0]))} />
      {unreadable > 0 && <Banner tone="warn">{unreadable === 1 ? 'One template' : `${unreadable} templates`} can’t be read here: saved by a newer Puddle, or damaged.</Banner>}
      <div className="flex max-h-[40vh] flex-col gap-1 overflow-auto" role="listbox" aria-label="Templates library">
        {!templates.length ? (
          <p className="text-ink-muted">No templates yet. Select a Transform node and choose Save as template in the inspector.</p>
        ) : !shown.length ? (
          <p className="text-ink-muted">No templates match.</p>
        ) : (
          shown.map((t) => (
            <div
              key={t.id}
              role="option"
              aria-selected={t.id === chosenId}
              aria-label={t.name}
              tabIndex={0}
              className={`flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 ${t.id === chosenId ? 'border-brand bg-surface-hover' : 'border-line hover:bg-surface-hover'}`}
              onClick={() => choose(t)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  choose(t);
                }
              }}
            >
              <span className="font-semibold">{t.name}</span>
              {t.description && <span className="text-label text-ink-muted">{t.description}</span>}
              <span className="text-label text-ink-subtle">
                {t.steps.length} {t.steps.length === 1 ? 'step' : 'steps'}
                {t.expectedColumns.length ? ` · expects ${t.expectedColumns.map((c) => c.name).join(', ')}` : ''}
              </span>
            </div>
          ))
        )}
      </div>
      {chosen && (
        <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="template-detail">
          <div className="flex flex-col gap-1">
            <span className="ui-eyebrow">Expects these columns</span>
            <Columns columns={chosen.expectedColumns} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="ui-eyebrow">Steps</span>
            <StepList steps={chosen.steps.map((s) => ({ label: s.label, disabled: !s.enabled }))} onAdd={false} />
          </div>
          {!feed ? (
            <Banner>No node is selected, so it goes on the canvas unwired, with its steps as they were saved.</Banner>
          ) : reading ? (
            <p className="text-label text-ink-muted">Reading the columns of {feedNode?.name}…</p>
          ) : !actual ? (
            <Banner tone="warn">Puddle can’t read the columns of {feedNode?.name} yet, so its steps arrive as they were saved.</Banner>
          ) : (
            <Mapping template={chosen} actual={actual} mapping={mapping} onChange={(name, column) => setPicks({ ...picks, [name]: column })} />
          )}
          <Manage key={chosen.id + chosen.updatedAt} template={chosen} />
        </div>
      )}
    </Dialog>
  );
}

/** The open template dialog, if any. */
export function TemplateDialogs() {
  const dialog = useTemplateDialog((s) => s.dialog);
  const project = useProject();
  if (!dialog) return null;
  if (dialog.kind === 'library') return <LibraryDialog />;
  const node = nodeById(project, dialog.nodeId);
  return node?.type === 'transform' ? <SaveDialog key={node.id} node={node} /> : null;
}
