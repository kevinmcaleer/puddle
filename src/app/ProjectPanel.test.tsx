// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addNode, addSource, createProject, inputEdges, setQueriesInPanel, useProjectStore, type Project } from '../model';
import { src } from '../../tests/helpers/projects';
import { ProjectPanel } from './ProjectPanel';
import { sqlName } from './outlineActions';
import { useSession } from './session';

const project = () => useProjectStore.getState().history.present;
const rows = (section: string) => within(screen.getByRole('region', { name: section })).queryAllByRole('button').filter((b) => b.dataset.testid?.startsWith('outline-'));
const names = (section: string) => rows(section).map((b) => b.dataset.testid!.slice('outline-'.length));

describe('the project panel', () => {
  beforeEach(() => {
    useSession.setState({ selectedNodeId: null, selectedNodeIds: [], renamingNodeId: null, notice: null });
    let p: Project = createProject('Panel');
    p = addSource(p, src({ id: 'orders', name: 'orders', format: 'csv' }), { x: 0, y: 0 }, 'orders');
    p = addSource(p, src({ id: 'shop customers', name: 'shop customers.csv', format: 'csv' }), { x: 0, y: 200 }, 'customers');
    useProjectStore.getState().load(p);
  });
  afterEach(cleanup);

  it('lists tables, queries and outputs, and a click selects and views the row’s node', () => {
    render(<ProjectPanel />);
    expect(names('Tables')).toEqual(['orders', 'shop customers.csv']);
    expect(names('Queries')).toEqual([]);
    expect(screen.getByText('Questions asked of the tables, in SQL or the designer.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('outline-shop customers.csv'));
    expect(useSession.getState().selectedNodeId).toBe('customers');
    expect(project().view.viewedNodeId).toBe('customers');
    expect(screen.getByTestId('outline-shop customers.csv').getAttribute('aria-current')).toBe('true');
  });

  it('makes a new query that reads the selected table by name, selected and asked for a name, in one undo step', () => {
    render(<ProjectPanel />);
    fireEvent.click(screen.getByTestId('outline-shop customers.csv'));
    fireEvent.click(screen.getByRole('button', { name: 'New query' }));
    const query = project().nodes.find((n) => n.type === 'sql')!;
    expect(query.type === 'sql' && query.sqlSpec.query).toBe('SELECT *\nFROM "shop customers.csv"');
    expect(inputEdges(project(), query.id).map((e) => [e.from.nodeId, e.byName])).toEqual([['customers', true]]);
    expect(useSession.getState().selectedNodeId).toBe(query.id);
    expect(useSession.getState().renamingNodeId).toBe(query.id);
    expect(screen.getByTestId('outline-SQL 1').textContent).toContain('reads shop customers.csv');
    expect(screen.getByTestId('outline-SQL 1').dataset.offCanvas).toBe('true');
    act(() => useProjectStore.getState().undo());
    expect(project().nodes.map((n) => n.id)).toEqual(['orders', 'customers']);
  });

  it('says a query needs a table when the project has none', () => {
    act(() => useProjectStore.getState().load(createProject('Empty')));
    render(<ProjectPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'New query' }));
    expect(project().nodes).toEqual([]);
    expect(useSession.getState().notice?.text).toBe('Add a table first: a query reads tables.');
  });

  it('offers to move queries to the panel only on a project that keeps them on the canvas, and removes a row with Delete', () => {
    act(() => useProjectStore.getState().apply((p) => setQueriesInPanel(addNode(p, 'sql', { x: 300, y: 0 }, 'orders'), false)));
    render(<ProjectPanel />);
    expect(screen.getByTestId('outline-SQL 1').dataset.offCanvas).toBeUndefined();
    fireEvent.click(screen.getByTestId('move-queries'));
    expect(project().settings.queriesInPanel).toBe(true);
    expect(screen.queryByTestId('move-queries')).toBeNull();
    expect(screen.getByTestId('outline-SQL 1').dataset.offCanvas).toBe('true');
    fireEvent.keyDown(screen.getByTestId('outline-SQL 1'), { key: 'Delete' });
    expect(names('Queries')).toEqual([]);
  });

  it('writes a table’s name bare when it is one word and quoted otherwise', () => {
    expect(sqlName('docs')).toBe('docs');
    expect(sqlName('shop customers.csv')).toBe('"shop customers.csv"');
    expect(sqlName('2024')).toBe('"2024"');
  });
});
