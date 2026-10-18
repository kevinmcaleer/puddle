import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useFlowStore } from '../flow/status';
import { useStepColumns } from '../inspector/useStepColumns';
import { groupOf, inputEdges, nodeById, useProject, type Step, type TransformNode } from '../model';
import { Banner, Button, Dialog, Field, StepList, Switch, TextInput } from '../ui';
import { insertFeed, insertTemplateAfter, openTemplateDialog, saveAsTemplate, useTemplateDialog } from './actions';
import { editTemplate, refreshTemplates, removeTemplate, templateOperations, useTemplates } from './library';
import { OperationButtons } from '../app/OperationButtons';
import { expectedColumns, suggestedMapping } from './mapping';
import { Columns, Mapping } from './Mapping';
import { exportTemplateRecipe, importTemplateFile } from '../recipes/actions';
import { notTemplatable, searchTemplates, type Template } from './template';

const close = () => openTemplateDialog(null);

/** Enter in a field that isn't the dialog's own does `then` instead of confirming the dialog. */
const onEnter = (then: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  then();
};

/**
 * Save the steps of a chain of Transform nodes (one node, or a line of them, in order), all of them or some, as a
 * template. A chain that is a group is named after the group.
 */
function SaveDialog({ nodes }: { nodes: TransformNode[] }) {
  const project = useProject();
  const head = nodes[0]!;
  const group = nodes.length > 1 ? groupOf(project, head.id) : undefined;
  const [name, setName] = useState(group?.name ?? head.name);
  const [description, setDescription] = useState('');
  // Every step along the chain, with the node it comes from, so the list reads in the order the data runs.
  const all = nodes.flatMap((n) => n.steps.map((step) => ({ node: n, step })));
  const [picked, setPicked] = useState(() => new Set(all.filter((s) => !notTemplatable(s.step)).map((s) => s.step.id)));
  const steps: Step[] = all.filter((s) => picked.has(s.step.id)).map((s) => s.step);
  const firstPicked = all.find((s) => picked.has(s.step.id)) ?? all[0];
  // The columns arriving at the first picked step are what the template's steps start from.
  const input = useStepColumns(project, firstPicked?.node.id ?? head.id, firstPicked ? firstPicked.node.steps.findIndex((s) => s.id === firstPicked.step.id) : 0);
  const wired = inputEdges(project, head.id).length > 0;
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
      <p className="text-label text-ink-muted">
        A template keeps {nodes.length > 1 ? `the steps of these ${nodes.length} nodes` : 'the steps'} and the columns they expect, never data or sources. Every project in this browser can use it. To keep a whole flow, with its sources, export a recipe instead.
      </p>
      <Field label="Name" htmlFor="template-name">
        <TextInput id="template-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="template-description">
        <textarea id="template-description" className="ui-input min-h-[var(--size-row)] w-full resize-y py-1" rows={2} value={description} placeholder="What it cleans, and what it expects." onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex flex-col gap-1" role="group" aria-label="Steps">
        <span className="ui-eyebrow">Steps</span>
        {all.map(({ node, step: s }) => {
          const reason = notTemplatable(s);
          const label = nodes.length > 1 ? `${node.name}: ${s.label}` : s.label;
          return (
            <div key={s.id} title={reason}>
              <Switch
                label={reason ? `${label} (can’t go in a template)` : label}
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
      <Button size="sm" variant="ghost" icon="export" title="Download as a single-node recipe, to share" onClick={() => exportTemplateRecipe(template)}>
        Export
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

/** The templates library: search, preview, map the input's columns and insert; rename, describe and delete. */
function LibraryDialog() {
  const templates = useTemplates((s) => s.templates);
  const unreadable = useTemplates((s) => s.unreadable);
  const [query, setQuery] = useState('');
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Picks made in the mapping, '' for Leave unmapped; columns not picked yet take their suggestion.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [feed] = useState(insertFeed);
  const importInput = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [imported, setImported] = useState<{ tone: 'info' | 'fail'; text: string } | null>(null);
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
      <div className="flex gap-2">
        <input className="ui-input min-w-0 flex-1" aria-label="Search templates" placeholder="Search templates" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} onKeyDown={onEnter(() => shown[0] && choose(shown[0]))} />
        <Button variant="ghost" icon="source" title="Add a template from a .puddle-recipe.json file" onClick={() => importInput.current?.click()}>
          Import template
        </Button>
        <div ref={body} className="flex">
          <OperationButtons ops={templateOperations} within={body} onError={(text) => setImported({ tone: 'fail', text })} />
        </div>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="template-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file)
              void importTemplateFile(file).then(({ template, ...result }) => {
                setImported(result);
                if (template) choose(template);
              });
          }}
        />
      </div>
      {imported && <Banner tone={imported.tone}>{imported.text}</Banner>}
      {unreadable > 0 && <Banner tone="warn">{unreadable === 1 ? 'One template' : `${unreadable} templates`} can’t be read here: saved by a newer Puddle, or damaged.</Banner>}
      <div className="flex max-h-[40vh] flex-col gap-1 overflow-auto" role="listbox" aria-label="Templates library">
        {!templates.length ? (
          <p className="text-ink-muted">No templates yet. Select a Transform node, or a group of them, and choose Save as template. A whole flow, sources and all, is a recipe: see Export recipe in the project menu.</p>
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
            <Mapping expected={chosen.expectedColumns} actual={actual} mapping={mapping} onChange={(name, column) => setPicks({ ...picks, [name]: column })} />
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
  const nodes = dialog.nodeIds.map((id) => nodeById(project, id)).filter((n): n is TransformNode => n?.type === 'transform');
  return nodes.length ? <SaveDialog key={nodes.map((n) => n.id).join()} nodes={nodes} /> : null;
}
