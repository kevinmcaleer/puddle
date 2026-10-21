import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { nodeFor } from '../schemaTables/sample';
import { addAllSchemaTables } from '../schemaTables/place';
import { useSession } from '../app/session';
import { editSchema, setSchemaDbml, useProject, useProjectStore, type Project } from '../model';
import { useRelationships } from '../relationships/useRelationships';
import { Banner, Button, Menu, Switch } from '../ui';
import { canvasSchema, withCanvas } from './canvas';
import { tableId, type Point } from './diagram/geometry';
import { SchemaDiagram } from './diagram/SchemaDiagram';
import type { DiagramEdit } from './diagram/editing';
import { DbmlEditor, type DbmlEditorHandle } from './editor/DbmlEditor';
import { EXAMPLE_DBML } from './example';
import { parseDbml } from './parse';
import { addTable } from './edit';
import { documentedCover } from '../connections/document';
import { ExportDocsDialog } from './ExportDocsDialog';
import { ExportImageDialog } from './ExportImageDialog';
import { ExportMermaidDialog } from './ExportMermaidDialog';
import { ExportSqlDialog } from './ExportSqlDialog';
import { FillSampleDialog } from './FillSampleDialog';
import { TableSampleView } from './TableSampleView';
import { ImportSqlDialog } from './ImportSqlDialog';
import { layoutDiagram } from './diagram/geometry';
import { SchemaViews } from './SchemaViews';
import { ShareDialog } from './ShareDialog';
import { VersionsDialog } from './VersionsDialog';
import { currentView, hideFromSchemaView, openSchemaView, moveInSchemaView, setSchemaZoom, showCanvasInSchema, viewPositions, viewTables } from './views';
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

/**
 * The canvas's tables, queries and views as a schema, with the relationships the project states as refs; the same
 * object while what it says stays the same, so the diagram isn't laid out again on every status change.
 */
function useCanvasSchema(project: Project, designed: ReturnType<typeof parseDbml>['schema']) {
  const { columnsOf, unique } = useRelationships(project);
  const canvas = project.schema.hideCanvas ? null : canvasSchema(project, designed, columnsOf, unique);
  const signature = canvas ? JSON.stringify([canvas.schema, [...canvas.nodeOf]]) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => canvas, [signature, designed]);
}

/**
 * The Schema view, in place of the canvas: DBML on the left, the diagram it draws on the right, and with it, unless
 * turned off, every table, query and view on the canvas and the relationships between them, as Access documents a
 * database.
 */
export function SchemaView() {
  const project = useProject();
  const dbml = project.schema.dbml;
  const deferred = useDeferredValue(dbml);
  const { schema, errors } = useMemo(() => parseDbml(deferred), [deferred]);
  const canvas = useCanvasSchema(project, schema);
  /** What the diagram draws and the exports write: the DBML's tables, then the canvas's. */
  const shown = useMemo(() => (canvas ? withCanvas(schema, canvas.schema) : schema), [schema, canvas]);
  const typing = useTypingSession();
  const editor = useRef<DbmlEditorHandle>(null);
  const split = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(editorShare);
  const [caret, setCaret] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState<'sql' | 'image' | 'mermaid' | 'docs' | null>(null);
  const [sharing, setSharing] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filling, setFilling] = useState<string[] | null>(null);
  // Tables to select on the diagram once they are drawn (those just imported).
  const [choose, setChoose] = useState<string[]>();
  const view = currentView(project.schema);
  const only = useMemo(() => viewTables(view), [view]);
  /** The tables to fill: the selected ones, else every table on show. */
  const fillTargets = () => {
    const picked = selected.filter((id) => id.startsWith('table:') && !canvas?.derived.has(id));
    return picked.length ? picked : schema.tables.map(tableId).filter((id) => !only || only.has(id));
  };

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
        {canvas && (
          <span className="ui-metric" data-testid="schema-canvas-counts">
            {canvas.schema.tables.length} from the canvas
          </span>
        )}
        <Switch
          id="schema-show-canvas"
          label="Canvas"
          checked={!project.schema.hideCanvas}
          onChange={(show) => useProjectStore.getState().amend((p) => showCanvasInSchema(p, show))}
        />
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
        <Button size="sm" variant="ghost" icon="database" onClick={() => setImporting(true)}>
          Import SQL
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="template"
          disabled={!schema.tables.length}
          title="Rows that keep the design, for the selected tables or every table on show"
          onClick={() => setFilling(fillTargets())}
        >
          Fill with sample data
        </Button>
        <Menu
          label="Export"
          button={{ size: 'sm', variant: 'ghost', icon: 'export', disabled: !shown.tables.length }}
          items={[
            { label: 'Image…', hint: 'SVG, PNG or PDF of this view', onSelect: () => setExporting('image') },
            { label: 'Mermaid…', hint: 'An erDiagram for a README', onSelect: () => setExporting('mermaid') },
            { label: 'SQL…', hint: 'PostgreSQL, MySQL, SQL Server, SQLite or DuckDB', onSelect: () => setExporting('sql') },
            { label: 'Docs…', hint: 'A page documenting every table, or Markdown', onSelect: () => setExporting('docs') },
          ]}
        />
        <Button size="sm" variant="ghost" icon="link" disabled={!dbml.trim()} onClick={() => setSharing(true)}>
          Share
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="clock"
          onClick={() => {
            typing.settle();
            setVersioning(true);
          }}
        >
          Versions
        </Button>
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
          {shown.tables.length > 0 && <SchemaViews project={project} schema={shown} selected={selected} />}
          <div className="puddle-schema__stage">
            {shown.tables.length ? (
              <SchemaDiagram
                // A view opens where it was left: its own pan and zoom.
                key={view?.id ?? 'all'}
                schema={shown}
                locked={canvas?.derived}
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
                choose={choose}
                sample={(t) => <TableSampleView schema={schema} table={t} nodeId={canvas?.nodeOf.get(tableId(t))} />}
                tableActions={(t) => {
                  const id = tableId(t);
                  const node = nodeFor(project, t) ?? project.nodes.find((n) => n.id === canvas?.nodeOf.get(id));
                  const open = node && {
                    label: 'Open in results',
                    icon: 'eye' as const,
                    group: 'Data',
                    onSelect: () => {
                      useSession.getState().setSchemaOpen(false);
                      useSession.getState().select(node.id);
                    },
                  };
                  if (canvas?.derived.has(id))
                    return [
                      ...(open ? [open] : []),
                      ...(node?.type === 'query'
                        ? [{ label: 'Open in the query designer', icon: 'query' as const, group: 'Data', onSelect: () => (useSession.getState().setSchemaOpen(false), useSession.getState().openDesigner(node.id)) }]
                        : []),
                    ];
                  const fill = { label: 'Fill with sample data…', icon: 'template' as const, group: 'Data', onSelect: () => setFilling(selected.includes(id) ? fillTargets() : [id]) };
                  return open ? [fill, open] : [fill];
                }}
              />
            ) : (
              <div className="puddle-schema__empty">
                <p>Write a Table in the editor to see it here, or insert the example. Tables, queries and views on the canvas show here too while the Canvas switch is on.</p>
                <Button size="sm" variant="secondary" icon="plus" onClick={() => edit((d) => addTable(d, { schema: 'public', table: 'new_table' }))}>
                  Add a table
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
      {importing && (
        <ImportSqlDialog
          dbml={dbml}
          schema={schema}
          onClose={() => setImporting(false)}
          onImport={(next, tables) => {
            typing.settle();
            apply((p) => setSchemaDbml(openSchemaView(p, undefined), next));
            setChoose(tables);
          }}
        />
      )}
      {filling && (
        <FillSampleDialog
          dbml={dbml}
          schema={schema}
          tables={filling}
          onClose={() => setFilling(null)}
          onFill={(next, tables) => {
            typing.settle();
            apply((p) => setSchemaDbml(p, next));
            setChoose(tables);
          }}
        />
      )}
      {exporting === 'docs' && <ExportDocsDialog schema={shown} doc={project.schema} title={project.name || 'Schema'} subtitle={documentedCover(project.connections)} onClose={() => setExporting(null)} />}
      {versioning && <VersionsDialog project={project} apply={apply} onClose={() => setVersioning(false)} />}
      {sharing && <ShareDialog doc={project.schema} onClose={() => setSharing(false)} />}
      {exporting === 'sql' && <ExportSqlDialog schema={schema} onClose={() => setExporting(null)} />}
      {exporting === 'mermaid' && <ExportMermaidDialog schema={shown} detail={view?.detail ?? project.schema.detail} only={only} onClose={() => setExporting(null)} />}
      {exporting === 'image' && (
        <ExportImageDialog
          diagram={layoutDiagram(shown, viewPositions(project.schema, view), { detail: view?.detail ?? project.schema.detail, only })}
          selected={selected}
          fileName={view ? `${project.name || 'schema'} - ${view.name}` : project.name || 'schema'}
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  );
}
