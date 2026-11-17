import { flow, src } from '../../tests/helpers/projects';
import { addScriptTableNodes, setFileSet, setScriptTable, syncScriptTables } from './edits';
import { setQueriesInPanel } from './outline';
import type { Project } from './schema';

const base = () => flow({ nodes: [{ id: 'q', type: 'sql' }] });
const tablesOf = (p: Project) => p.nodes.flatMap((n) => (n.type === 'scriptTable' ? [[n.name, n.scriptTable.table]] : []));
const wiredFromQ = (p: Project) => p.edges.filter((e) => e.from.nodeId === 'q').map((e) => p.nodes.find((n) => n.id === e.to.nodeId)?.name);

describe('script table nodes', () => {
  it('appear for every table a script newly makes, even its only one, wired from the SQL node and stacked to its right', () => {
    const one = syncScriptTables(base(), 'q', [], ['log']);
    expect(tablesOf(one)).toEqual([['log', 'log']]);
    expect(wiredFromQ(one)).toEqual(['log']);
    const p = syncScriptTables(one, 'q', ['log'], ['log', 'users', 'docs']);
    expect(tablesOf(p)).toEqual([
      ['log', 'log'],
      ['users', 'users'],
      ['docs', 'docs'],
    ]);
    expect(wiredFromQ(p)).toEqual(['log', 'users', 'docs']);
    const ys = p.nodes.filter((n) => n.type === 'scriptTable').map((n) => n.position.y);
    expect(new Set(ys).size).toBe(3);
  });

  it('then only for tables the script newly makes, so a node deleted stays deleted', () => {
    const p = syncScriptTables(base(), 'q', [], ['log', 'users']);
    const without = { ...p, nodes: p.nodes.filter((n) => n.name !== 'users'), edges: p.edges.filter((e) => p.nodes.find((n) => n.id === e.to.nodeId)?.name !== 'users') };
    expect(tablesOf(syncScriptTables(without, 'q', ['log', 'users'], ['log', 'users', 'docs']))).toEqual([
      ['log', 'log'],
      ['docs', 'docs'],
    ]);
  });

  it('appear for the tables a Query’s SQL makes, and for no other kind of node', () => {
    const p = flow({ nodes: [{ id: 'q', type: 'query' }, { id: 'j', type: 'transform' }] });
    expect(tablesOf(syncScriptTables(p, 'q', [], ['big']))).toEqual([['big', 'big']]);
    expect(syncScriptTables(p, 'j', [], ['big'])).toEqual(p);
  });

  it('follow a table renamed in the script, keeping a name given by hand', () => {
    let p = syncScriptTables(base(), 'q', [], ['log', 'users']);
    p = { ...p, nodes: p.nodes.map((n) => (n.name === 'users' ? { ...n, name: 'People' } : n)) };
    expect(tablesOf(syncScriptTables(p, 'q', ['log', 'users'], ['steps', 'sap_users']))).toEqual([
      ['steps', 'steps'],
      ['People', 'sap_users'],
    ]);
  });

  it('take a free name, and can be added one at a time or pointed at another table', () => {
    const p = addScriptTableNodes(flow({ nodes: [{ id: 'q', type: 'sql' }, { id: 'log', type: 'transform' }] }), 'q', ['log', 'log']);
    expect(tablesOf(p)).toEqual([['log 2', 'log']]);
    const id = p.nodes.find((n) => n.type === 'scriptTable')!.id;
    expect(tablesOf(setScriptTable(p, id, 'users'))).toEqual([['log 2', 'users']]);
    const q = addScriptTableNodes(base(), 'q', ['users']);
    expect(tablesOf(setScriptTable(q, q.nodes.at(-1)!.id, 'docs'))).toEqual([['docs', 'docs']]);
  });
});

describe('file sets', () => {
  it('change their pattern, file column or runner folder', () => {
    const p = flow({ sources: [src({ id: 's', kind: 'files', format: 'parquet', fileSet: { files: [] } })], nodes: [{ id: 'n', type: 'source', sourceId: 's' }] });
    expect(setFileSet(p, 's', { pattern: '*.parquet', path: 'data' }).sources[0]!.fileSet).toEqual({ files: [], pattern: '*.parquet', path: 'data' });
  });
});

describe('a script and its tables as one card', () => {
  const groupsOf = (p: Project) => p.groups.map((g) => [g.name, g.collapsed, g.nodeIds.map((id) => p.nodes.find((n) => n.id === id)!.name)]);

  it('gathers the SQL node and the tables it makes into one collapsed group named after the node, and later tables join it', () => {
    const one = syncScriptTables(base(), 'q', [], ['log', 'users']);
    expect(groupsOf(one)).toEqual([['q', true, ['q', 'log', 'users']]]);
    const more = syncScriptTables(one, 'q', ['log', 'users'], ['log', 'users', 'docs']);
    expect(groupsOf(more)).toEqual([['q', true, ['q', 'log', 'users', 'docs']]]);
  });

  it('is not regrouped by a later edit once ungrouped, and never happens where queries stay on the canvas', () => {
    const made = syncScriptTables(base(), 'q', [], ['log']);
    const apart = { ...made, groups: [] };
    expect(syncScriptTables(apart, 'q', ['log'], ['log']).groups).toEqual([]);
    const onCanvas = setQueriesInPanel(base(), false);
    expect(syncScriptTables(onCanvas, 'q', [], ['log', 'users']).groups).toEqual([]);
  });
});
