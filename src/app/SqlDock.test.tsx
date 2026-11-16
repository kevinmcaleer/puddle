// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addNode, createProject, useProjectStore } from '../model';
import { DockedSql, SqlDockPane } from './SqlDock';
import { useSqlDock } from './sqlDockState';

const viewed = (id: string | undefined) => useProjectStore.getState().amend((p) => ({ ...p, view: { ...p.view, viewedNodeId: id } }));

describe('the SQL dock', () => {
  let nodeId = '';
  beforeEach(() => {
    useSqlDock.setState({ slot: null, owners: 0 });
    useProjectStore.getState().load(createProject('Dock'));
    useProjectStore.getState().apply((p) => addNode(p, 'sql', { x: 0, y: 0 }));
    nodeId = useProjectStore.getState().history.present.nodes[0]!.id;
  });
  afterEach(cleanup);

  const editor = () => (
    <DockedSql nodeId={nodeId} note={<p>Beside the rows</p>}>
      <textarea aria-label="SQL query" />
    </DockedSql>
  );

  it('holds the editor of the node whose rows are shown, leaving a note in its place', () => {
    act(() => viewed(nodeId));
    render(
      <>
        <div data-testid="inspector">{editor()}</div>
        <SqlDockPane />
      </>,
    );
    const dock = screen.getByTestId('sql-dock');
    expect(dock.contains(screen.getByLabelText('SQL query'))).toBe(true);
    expect(dock.hidden).toBe(false);
    expect(screen.getByTestId('inspector').textContent).toBe('Beside the rows');
    expect(screen.getByRole('separator', { name: 'Resize the SQL editor' })).toBeTruthy();
  });

  it('leaves the editor where it is drawn when another node’s rows are shown, and stays hidden', () => {
    act(() => viewed(undefined));
    render(
      <>
        <div data-testid="inspector">{editor()}</div>
        <SqlDockPane />
      </>,
    );
    expect(screen.getByTestId('inspector').contains(screen.getByLabelText('SQL query'))).toBe(true);
    expect(screen.getByTestId('sql-dock').hidden).toBe(true);
    expect(screen.queryByRole('separator')).toBeNull();
    // Its rows shown, it moves in.
    act(() => viewed(nodeId));
    expect(screen.getByTestId('sql-dock').contains(screen.getByLabelText('SQL query'))).toBe(true);
  });

  it('leaves the editor where it is drawn when there is no dock (the results hidden)', () => {
    act(() => viewed(nodeId));
    render(<div data-testid="inspector">{editor()}</div>);
    expect(screen.getByTestId('inspector').contains(screen.getByLabelText('SQL query'))).toBe(true);
  });
});
