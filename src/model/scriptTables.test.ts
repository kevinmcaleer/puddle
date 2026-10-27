import { flow, src } from '../../tests/helpers/projects';
import { addScriptTableNodes, setFileSet, setScriptTable, syncScriptTables } from './edits';
import type { Project } from './schema';

const base = () => flow({ nodes: [{ id: 'q', type: 'sql' }] });
const tablesOf = (p: Project) => p.nodes.flatMap((n) => (n.type === 'scriptTable' ? [[n.name, n.scriptTable.table]] : []));
const wiredFromQ = (p: Project) => p.edges.filter((e) => e.from.nodeId === 'q').map((e) => p.nodes.find((n) => n.id === e.to.nodeId)?.name);

describe('script table nodes', () => {
  it('appear for every table once a script makes two or more, wired from the SQL node and stacked to its right', () => {
    expect(syncScriptTables(base(), 'q', [], ['log'])).toEqual(base());
    const p = syncScriptTables(base(), 'q', ['log'], ['log', 'users', 'docs']);
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
