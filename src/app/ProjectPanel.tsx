import { useState, type KeyboardEvent } from 'react';
import { useFlowStore } from '../flow/status';
import { hasQueriesToMove, projectOutline, useProject, type OutlineRow } from '../model';
import { Button, ContextMenu, Icon, NODE_KIND, Section, type MenuItem } from '../ui';
import { addQueryFromPanel, moveQueriesToPanel, openFromPanel, removeFromPanel } from './outlineActions';
import { useSession } from './session';
import './projectPanel.css';

/**
 * The project panel, beside the canvas: the project as a list of its tables, the queries asked of them and its
 * outputs, as Access's navigation pane lists a database. A click selects and shows a row's node; queries that are
 * listed here only (see offCanvasIds) are reached from here.
 */
export function ProjectPanel() {
  const project = useProject();
  const outline = projectOutline(project);
  const [menu, setMenu] = useState<{ x: number; y: number; row: OutlineRow } | null>(null);
  const items = (row: OutlineRow): MenuItem[] => [
    ...(row.node.type === 'query' ? [{ label: 'Open in the designer', icon: 'query' as const, onSelect: () => useSession.getState().openDesigner(row.node.id) }] : []),
    { label: 'Rename…', onSelect: () => useSession.getState().askRename(row.node.id) },
    { label: 'Delete', onSelect: () => removeFromPanel(row.node.id) },
  ];
  const list = (rows: OutlineRow[], empty: string) =>
    rows.length ? (
      <ul className="puddle-outline__list">
        {rows.map((row) => (
          <Row key={row.node.id} row={row} onMenu={(x, y) => setMenu({ x, y, row })} />
        ))}
      </ul>
    ) : (
      <p className="text-label text-ink-muted">{empty}</p>
    );
  return (
    <aside className="puddle-outline" aria-label="Project panel" data-testid="project-panel">
      <div className="puddle-outline__head">
        <h2 className="ui-eyebrow">Project</h2>
        <Button variant="ghost" size="sm" icon="outline-close" iconOnly aria-label="Hide the project panel" title="Hide the project panel" onClick={() => useSession.getState().setOutlineOpen(false)} />
      </div>
      <div className="puddle-outline__body">
        <Section title="Tables" count={outline.tables.length}>
          {list(outline.tables, 'Add a file, a database table or pasted rows.')}
        </Section>
        <Section
          title="Queries"
          count={outline.queries.length}
          action={<Button variant="ghost" size="sm" icon="plus" iconOnly aria-label="New query" title="New query, reading the selected table" onClick={() => addQueryFromPanel()} />}
        >
          {list(outline.queries, 'Questions asked of the tables, in SQL or the designer.')}
          {hasQueriesToMove(project) && (
            <Button size="sm" variant="secondary" data-testid="move-queries" title="Queries that end a flow are listed here and leave the canvas, which then shows only how tables are made" onClick={() => moveQueriesToPanel(true)}>
              Move queries to the panel
            </Button>
          )}
        </Section>
        <Section title="Outputs" count={outline.outputs.length}>
          {list(outline.outputs, 'Add an Output after a table or a query to export it.')}
        </Section>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} label={`Actions for ${menu.row.node.name}`} items={items(menu.row)} onClose={() => setMenu(null)} />}
    </aside>
  );
}

function Row({ row, onMenu }: { row: OutlineRow; onMenu: (x: number, y: number) => void }) {
  const { node, reads } = row;
  const selected = useSession((s) => s.selectedNodeId === node.id);
  const state = useFlowStore((s) => s.nodes[node.id]?.status.state);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') removeFromPanel(node.id);
    else if (e.key === 'F2') useSession.getState().askRename(node.id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <li>
      <button
        type="button"
        className="puddle-outline__row"
        aria-current={selected ? 'true' : undefined}
        data-testid={`outline-${node.name}`}
        data-status={state}
        data-off-canvas={row.offCanvas || undefined}
        onClick={() => openFromPanel(node.id)}
        onDoubleClick={() => node.type === 'query' && useSession.getState().openDesigner(node.id)}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY);
        }}
      >
        <Icon name={NODE_KIND[node.type === 'lookup' ? 'join' : node.type].icon} size={14} />
        <span className="puddle-outline__text">
          <span className="puddle-outline__name">{node.name}</span>
          {reads && <span className="puddle-outline__reads">{reads.length ? `reads ${reads.join(', ')}` : 'reads no table yet'}</span>}
        </span>
        {state === 'error' && <Icon name="alert" size={14} className="text-fail" />}
      </button>
    </li>
  );
}
