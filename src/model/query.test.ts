import { flow, src } from '../../tests/helpers/projects';
import { addNode } from './edits';
import { GraphError, inputPorts } from './graph';
import { initHistory, pushHistory, undo } from './history';
import { parseProject } from './project';
import { addQueryField, addQueryJoin, addQueryTable, moveQueryField, moveQueryTable, removeQueryField, removeQueryJoin, removeQueryTable, setQueryJoinKind, updateQueryField } from './query';
import type { Project, QueryNode } from './schema';

const base = () =>
  flow({
    sources: [src({ id: 'a', format: 'csv' })],
    nodes: [
      { id: 'cust', type: 'source', sourceId: 'a' },
      { id: 'ord', type: 'source', sourceId: 'a' },
      { id: 'q', type: 'query' },
      { id: 'out', type: 'output' },
    ],
    wires: [['q', 'out']],
  });

const q = (p: Project) => p.nodes.find((n) => n.id === 'q') as QueryNode;
const spec = (p: Project) => q(p).querySpec;
const ports = (p: Project) => inputPorts(p, q(p)).map((x) => x.id);
const twoTables = () => addQueryTable(addQueryTable(base(), 'q', 'cust', 'e1'), 'q', 'ord', 'e2');

describe('query tables', () => {
  it('starts with one numbered input and gains a spare as tables are added', () => {
    let p = base();
    expect(ports(p)).toEqual([0]);
    p = addQueryTable(p, 'q', 'cust');
    expect(ports(p)).toEqual([0, 1]);
    p = addQueryTable(p, 'q', 'ord');
    expect(ports(p)).toEqual([0, 1, 2]);
    expect(p.edges.filter((e) => e.to.nodeId === 'q').map((e) => [e.from.nodeId, e.to.port])).toEqual([['cust', 0], ['ord', 1]]);
  });

  it('places new tables side by side in the designer', () => {
    expect(spec(twoTables()).tables).toEqual([{ port: 0, x: 24, y: 24 }, { port: 1, x: 264, y: 24 }]);
  });

  it('can add the same table twice, for a self-join', () => {
    const p = addQueryTable(addQueryTable(base(), 'q', 'cust'), 'q', 'cust');
    expect(p.edges.filter((e) => e.to.nodeId === 'q').map((e) => e.to.port)).toEqual([0, 1]);
  });

  it('refuses a table that would make a loop', () => {
    expect(() => addQueryTable(base(), 'q', 'out')).toThrow(GraphError);
  });

  it('removing a table takes its wire, its fields and its join lines with it', () => {
    let p = twoTables();
    p = addQueryField(p, 'q', { port: 0, column: 'name' }, undefined, 'f1');
    p = addQueryField(p, 'q', { port: 1, column: 'total' }, undefined, 'f2');
    p = addQueryJoin(p, 'q', { port: 0, column: 'customer_id' }, { port: 1, column: 'customer_id' }, 'j1');
    p = removeQueryTable(p, 'q', 1);
    expect(p.edges.some((e) => e.from.nodeId === 'ord')).toBe(false);
    expect(spec(p).fields.map((f) => f.id)).toEqual(['f1']);
    expect(spec(p).joins).toEqual([]);
    expect(spec(p).tables.map((t) => t.port)).toEqual([0]);
  });

  it('moves a table, rounding its position', () => {
    expect(spec(moveQueryTable(twoTables(), 'q', 1, { x: 300.4, y: 120.6 })).tables.find((t) => t.port === 1)).toEqual({ port: 1, x: 300, y: 121 });
  });
});

describe('query fields', () => {
  it('adds fields at the end or at a place, updates, moves and removes them', () => {
    let p = twoTables();
    p = addQueryField(p, 'q', { port: 0, column: 'name' }, undefined, 'f1');
    p = addQueryField(p, 'q', { port: 1, column: 'total' }, undefined, 'f2');
    p = addQueryField(p, 'q', { port: 1, column: 'order_id' }, 0, 'f3');
    expect(spec(p).fields.map((f) => f.id)).toEqual(['f3', 'f1', 'f2']);
    expect(spec(p).fields[1]).toEqual({ id: 'f1', port: 0, column: 'name', show: true, sort: 'none' });
    p = updateQueryField(p, 'q', 'f2', { sort: 'desc', alias: 'amount', criteria: { op: '>', value: '5' } });
    expect(spec(p).fields[2]).toMatchObject({ sort: 'desc', alias: 'amount', criteria: { op: '>', value: '5' } });
    p = moveQueryField(p, 'q', 'f3', 2);
    expect(spec(p).fields.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    p = removeQueryField(p, 'q', 'f2');
    expect(spec(p).fields.map((f) => f.id)).toEqual(['f1', 'f3']);
  });
});

describe('join lines', () => {
  it('joins a field of one table to a field of another, once', () => {
    let p = twoTables();
    p = addQueryJoin(p, 'q', { port: 0, column: 'customer_id' }, { port: 1, column: 'customer_id' }, 'j1');
    p = addQueryJoin(p, 'q', { port: 1, column: 'customer_id' }, { port: 0, column: 'customer_id' }, 'j2');
    expect(spec(p).joins).toEqual([{ id: 'j1', left: { port: 0, column: 'customer_id' }, right: { port: 1, column: 'customer_id' }, kind: 'inner' }]);
  });

  it('ignores a line from a table to itself', () => {
    const p = twoTables();
    expect(addQueryJoin(p, 'q', { port: 0, column: 'a' }, { port: 0, column: 'b' })).toBe(p);
  });

  it('keeps every line between two tables on one join type, turned round for a line drawn the other way', () => {
    let p = twoTables();
    p = addQueryJoin(p, 'q', { port: 0, column: 'customer_id' }, { port: 1, column: 'customer_id' }, 'j1');
    p = setQueryJoinKind(p, 'q', 'j1', 'left');
    p = addQueryJoin(p, 'q', { port: 1, column: 'status' }, { port: 0, column: 'status' }, 'j2');
    expect(spec(p).joins.map((j) => j.kind)).toEqual(['left', 'right']);
    p = setQueryJoinKind(p, 'q', 'j2', 'inner');
    expect(spec(p).joins.map((j) => j.kind)).toEqual(['inner', 'inner']);
    p = setQueryJoinKind(p, 'q', 'j2', 'left');
    expect(spec(p).joins.map((j) => j.kind)).toEqual(['right', 'left']);
    p = removeQueryJoin(p, 'q', 'j1');
    expect(spec(p).joins.map((j) => j.id)).toEqual(['j2']);
  });
});

describe('query nodes', () => {
  it('Add node wires every feeding node in as a table', () => {
    const p = addNode(base(), 'query', { x: 0, y: 0 }, ['cust', 'ord'], 'q2');
    expect(p.edges.filter((e) => e.to.nodeId === 'q2').map((e) => [e.from.nodeId, e.to.port])).toEqual([['cust', 0], ['ord', 1]]);
    expect(p.nodes.find((n) => n.id === 'q2')).toMatchObject({ name: 'Query 1', querySpec: { tables: [], joins: [], fields: [], distinct: false } });
  });

  it('round-trips through the project format', () => {
    let p = twoTables();
    p = addQueryField(p, 'q', { port: 0, column: '*' }, undefined, 'f1');
    p = addQueryJoin(p, 'q', { port: 0, column: 'customer_id' }, { port: 1, column: 'customer_id' }, 'j1');
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('every designer edit is one undoable step', () => {
    const p0 = twoTables();
    let h = initHistory(p0);
    h = pushHistory(h, addQueryJoin(h.present, 'q', { port: 0, column: 'customer_id' }, { port: 1, column: 'customer_id' }, 'j1'));
    h = pushHistory(h, addQueryField(h.present, 'q', { port: 0, column: 'name' }, undefined, 'f1'));
    h = undo(h);
    expect(spec(h.present).fields).toEqual([]);
    expect(spec(h.present).joins).toHaveLength(1);
    h = undo(h);
    expect(h.present).toEqual(p0);
  });
});
