import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addAllSchemaTables } from '../schemaTables/place';
import { useSession } from '../app/session';
import { editSchema, setSchemaDbml, useProject, useProjectStore, type Project } from '../model';
import { Banner, Button, Menu } from '../ui';
import { tableId, type Point } from './diagram/geometry';
import { SchemaDiagram } from './diagram/SchemaDiagram';
import type { DiagramEdit } from './diagram/editing';
import { DbmlEditor, type DbmlEditorHandle } from './editor/DbmlEditor';
import { EXAMPLE_DBML } from './example';
import { parseDbml } from './parse';
import { addTable } from './edit';
import { ExportImageDialog } from './ExportImageDialog';
import { ExportMermaidDialog } from './ExportMermaidDialog';
import { ExportSqlDialog } from './ExportSqlDialog';
import { layoutDiagram } from './diagram/geometry';
import { SchemaViews } from './SchemaViews';
import { currentView, hideFromSchemaView, moveInSchemaView, setSchemaZoom, viewPositions, viewTables } from './views';
import './schema.css';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/**
 * Typing in the editor reaches the project at once (so autosave has it); each burst of typing, up to a pause or the
 * editor losing focus, is one undo step.
 */
function useTypingSession() {
  const before = useRef<Project | null>(null);
  const settle = () => {
    const start = before.current;
    before.current = null;
    const { history, checkpoint } = useProjectStore.getState();
    if (start && start.schema.dbml !== history.present.schema.dbml) checkpoint(start);
  };
  useEffect(() => settle, []);
  return {
    change: (dbml: string) => {
      before.current ??= useProjectStore.getState().history.present;
      useProjectStore.getState().amend((p) => setSchemaDbml(p, dbml));
    },
    settle,
  };
}

const MIN_PANE = 240;

/** The editor's share of the width, as a fraction, while this tab is open. */
let editorShare = 0.4;

/** The Schema view, in place of the canvas: DBML on the left, the diagram it draws on the right. */
export function SchemaView() {
  const project = useProject();
  const dbml = project.schema.dbml;
  const deferred = useDeferredValue(dbml);
  const { schema, errors } = useMemo(() => parseDbml(deferred), [deferred]);
  const typing = useTypingSession();
  const editor = useRef<DbmlEditorHandle>(null);
  const split = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(editorShare);
  const [caret, setCaret] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState<'sql' | 'image' | 'mermaid' | null>(null);
  const view = currentView(project.schema);
  const only = useMemo(() => viewTables(view), [view]);

  const current = useMemo(() => {
    if (caret == null) return null;
    const t = schema.tables.find((x) => x.range && x.range.start <= caret && caret <= x.range.end);
    return t ? tableId(t) : null;
  }, [schema, caret]);

  const pick = (id: string, column?: string) => {
    const t = schema.tables.find((x) => tableId(x) === id);
    if (!t) return;
    const c = column ? t.columns.find((x) => x.name === column) : undefined;
    const range = c?.range ?? t.nameRange ?? t.range;
    if (range) editor.current?.select(range.start, range.end);
  };

  /** An edit made on the diagram: the text changed in place, as one undo step; one it can't make says why. */
  const edit: DiagramEdit = (change, also) => {
    typing.settle();
    const before = useProjectStore.getState().history.present;
    let dbml: string;
    try {
      dbml = change(before.schema.dbml);
    } catch (e) {
      useSession.getState().notify({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (dbml !== before.schema.dbml || also?.places) apply((p) => editSchema(p, dbml, also));
  };

  const resize = (fraction: number) => {
    const width = split.current?.clientWidth ?? 1000;
    const min = Math.min(0.45, MIN_PANE / width);
    const next = Math.min(1 - min, Math.max(min, fraction));
    editorShare = next;
    setShare(next);
  };

  const dragDivider = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !split.current) return;
    e.preventDefault();
    const box = split.current.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => resize((ev.clientX - box.left) / box.width);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const dividerKeys = (e: ReactKeyboardEvent) => {
    const by = { ArrowLeft: -0.05, ArrowRight: 0.05 }[e.key];
    if (by == null) return;
    e.preventDefault();
    resize(share + by);
  };

  return (
    <div className="puddle-schema" data-testid="schema-view">
      <div className="puddle-schema__bar" role="toolbar" aria-label="Schema">
        <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => useSession.getState().setSchemaOpen(false)}>
          Back to canvas
        </Button>
        <h2 className="type-heading">Schema</h2>
        <span className="ui-metric" data-testid="schema-counts">
          {schema.tables.length} {schema.tables.length === 1 ? 'table' : 'tables'}, {schema.refs.length} {schema.refs.length === 1 ? 'ref' : 'refs'}
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          disabled={!schema.tables.length}
          title="A Schema table node for each table, holding its rows"
          onClick={() => {
            apply((p) => addAllSchemaTables(p).project);
            useSession.getState().setSchemaOpen(false);
          }}
        >
          Add all tables
        </Button>
        <Menu
          label="Export"
          button={{ size: 'sm', variant: 'ghost', icon: 'export', disabled: !schema.tables.length }}
          items={[
            { label: 'Image…', hint: 'SVG, PNG or PDF of this view', onSelect: () => setExporting('image') },
            { label: 'Mermaid…', hint: 'An erDiagram for a README', onSelect: () => setExporting('mermaid') },
            { label: 'SQL…', hint: 'PostgreSQL, MySQL, SQL Server, SQLite or DuckDB', onSelect: () => setExporting('sql') },
          ]}
        />
        <Button size="sm" variant="ghost" onClick={() => apply((p) => setSchemaDbml(p, p.schema.dbml.trim() ? `${p.schema.dbml.trimEnd()}\n\n${EXAMPLE_DBML}` : EXAMPLE_DBML))}>
          Insert example
        </Button>
        <Button size="sm" variant="ghost" disabled={!dbml} onClick={() => apply((p) => setSchemaDbml(p, ''))}>
          Clear
        </Button>
      </div>
      <div ref={split} className="puddle-schema__split" style={{ gridTemplateColumns: `minmax(0, ${share}fr) auto minmax(0, ${1 - share}fr)` }}>
        <section className="puddle-schema__code" aria-label="DBML editor">
          <DbmlEditor
            ref={editor}
            value={dbml}
            schema={schema}
            errors={deferred === dbml ? errors : []}
            placeholder={EXAMPLE_DBML}
            onChange={typing.change}
            onSettle={typing.settle}
            onCaret={setCaret}
          />
          {errors.length > 0 && (
            <Banner tone="fail" title={errors.length === 1 ? 'One mistake' : `${errors.length} mistakes`}>
              <ul className="puddle-schema__errors" data-testid="schema-errors">
                {errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    <button type="button" className="ui-link" onClick={() => editor.current?.focusAt(e.start)}>
                      Line {e.line}
                    </button>{' '}
                    {e.message}
                  </li>
                ))}
              </ul>
            </Banner>
          )}
        </section>
        <div
          className="puddle-schema__divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the editor"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          tabIndex={0}
          onPointerDown={dragDivider}
          onKeyDown={dividerKeys}
        />
        <section className="puddle-schema__pane" aria-label="Diagram">
          {schema.tables.length > 0 && <SchemaViews project={project} schema={schema} selected={selected} />}
          <div className="puddle-schema__stage">
            {schema.tables.length ? (
              <SchemaDiagram
                // A view opens where it was left: its own pan and zoom.
                key={view?.id ?? 'all'}
                schema={schema}
                positions={viewPositions(project.schema, view)}
                detail={view?.detail ?? project.schema.detail}
                only={only}
                initialView={view ? view.zoom : project.schema.zoom}
                current={current}
                onMove={(moves: Record<string, Point>) => apply((p) => moveInSchemaView(p, moves))}
                onPick={pick}
                onEdit={edit}
                onViewChange={(zoom) => useProjectStore.getState().amend((p) => setSchemaZoom(p, zoom))}
                onSelectionChange={setSelected}
                onHide={view && ((ids) => apply((p) => hideFromSchemaView(p, view.id, ids)))}
              />
            ) : (
              <div className="puddle-schema__empty">
                <p>Write a Table in the editor to see it here, or insert the example.</p>
                <Button size="sm" variant="secondary" icon="plus" onClick={() => edit((d) => addTable(d, { schema: 'public', table: 'new_table' }))}>
                  Add a table
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
      {exporting === 'sql' && <ExportSqlDialog schema={schema} onClose={() => setExporting(null)} />}
      {exporting === 'mermaid' && <ExportMermaidDialog schema={schema} detail={view?.detail ?? project.schema.detail} only={only} onClose={() => setExporting(null)} />}
      {exporting === 'image' && (
        <ExportImageDialog
          diagram={layoutDiagram(schema, viewPositions(project.schema, view), { detail: view?.detail ?? project.schema.detail, only })}
          selected={selected}
          fileName={view ? `${project.name || 'schema'} - ${view.name}` : project.name || 'schema'}
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  );
}
