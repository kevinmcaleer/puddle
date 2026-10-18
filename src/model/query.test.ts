import { flow, src } from '../../tests/helpers/projects';
import { addNode } from './edits';
import { GraphError, inputPorts } from './graph';
import { initHistory, pushHistory, redo, undo } from './history';
import { parseProject } from './project';
import { addQueryField, addQueryJoin, addQueryOrRow, addQueryTable, criteriaCell, moveQueryField, moveQueryTable, removeQueryField, removeQueryJoin, removeQueryOrRow, removeQueryTable, setQueryCriteria, setQueryDesign, setQueryJoinKind, setQuerySpec, setQuerySql, updateQueryField } from './query';
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

describe('the Totals row', () => {
  const withSum = () => {
    let p = addQueryField(addQueryField(twoTables(), 'q', { port: 1, column: 'customer_id' }, undefined, 'f1'), 'q', { port: 1, column: 'total' }, undefined, 'f2');
    p = setQuerySpec(p, 'q', { totals: true });
    return updateQueryField(p, 'q', 'f2', { total: 'sum', alias: 'Spend' });
  };

  it('is off in a new query, and in a project saved before it existed', () => {
    expect(spec(addNode(base(), 'query', { x: 0, y: 0 }, [], 'q2')).totals).toBe(false);
    const saved = JSON.parse(JSON.stringify(withSum()));
    delete saved.nodes.find((n: { id: string }) => n.id === 'q').querySpec.totals;
    expect(spec(parseProject(saved)).totals).toBe(false);
  });

  it('turning it off keeps each field’s Total, so turning it on again brings them back', () => {
    const off = setQuerySpec(withSum(), 'q', { totals: false });
    expect(spec(off).fields.map((f) => f.total)).toEqual([undefined, 'sum']);
    expect(setQuerySpec(off, 'q', { totals: true })).toEqual(withSum());
  });

  it('round-trips Totals, expressions and Where fields through the project format', () => {
    let p = updateQueryField(withSum(), 'q', 'f1', { total: 'expression', expression: 'count(*)' });
    p = addQueryField(p, 'q', { port: 1, column: 'status' }, undefined, 'f3');
    p = updateQueryField(p, 'q', 'f3', { total: 'where', show: false, criteria: { op: '=', value: 'shipped' } });
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('or rows', () => {
  const grid = () => {
    let p = addQueryField(addQueryField(twoTables(), 'q', { port: 0, column: 'status' }, undefined, 'f1'), 'q', { port: 1, column: 'total' }, undefined, 'f2');
    p = setQueryCriteria(p, 'q', 'f1', 0, { op: '=', value: 'lapsed' });
    return p;
  };
  const cells = (p: Project, row: number) => spec(p).fields.map((f) => criteriaCell(f, row));

  it('adds rows below Criteria and sets a field’s condition in any of them', () => {
    let p = addQueryOrRow(addQueryOrRow(grid(), 'q'), 'q');
    expect(spec(p).orRows).toBe(2);
    p = setQueryCriteria(p, 'q', 'f2', 2, { op: '>', value: '10' });
    expect(cells(p, 0)).toEqual([{ op: '=', value: 'lapsed' }, undefined]);
    expect(cells(p, 1)).toEqual([undefined, undefined]);
    expect(cells(p, 2)).toEqual([undefined, { op: '>', value: '10' }]);
    expect(spec(p).fields[1]!.or).toEqual([null, { op: '>', value: '10' }]);
    // A row that isn't there takes nothing.
    expect(setQueryCriteria(p, 'q', 'f2', 3, { op: '>', value: '1' })).toBe(p);
  });

  it('clearing a cell keeps the field’s list short', () => {
    let p = setQueryCriteria(addQueryOrRow(grid(), 'q'), 'q', 'f2', 1, { op: '>', value: '10' });
    p = setQueryCriteria(p, 'q', 'f2', 1, undefined);
    expect(spec(p).fields[1]).not.toHaveProperty('or');
    p = setQueryCriteria(p, 'q', 'f1', 0, undefined);
    expect(spec(p).fields[0]).not.toHaveProperty('criteria');
  });

  it('removing a row takes its cells, and the rows below move up', () => {
    let p = addQueryOrRow(addQueryOrRow(grid(), 'q'), 'q');
    p = setQueryCriteria(p, 'q', 'f2', 1, { op: '>', value: '10' });
    p = setQueryCriteria(p, 'q', 'f1', 2, { op: '=', value: 'active' });
    p = removeQueryOrRow(p, 'q', 1);
    expect(spec(p).orRows).toBe(1);
    expect(cells(p, 1)).toEqual([{ op: '=', value: 'active' }, undefined]);
    expect(removeQueryOrRow(p, 'q', 2)).toBe(p);
  });

  it('removing every or row gives the original query', () => {
    const before = grid();
    let p = addQueryOrRow(addQueryOrRow(before, 'q'), 'q');
    p = setQueryCriteria(p, 'q', 'f2', 1, { op: '>', value: '10' });
    p = setQueryCriteria(p, 'q', 'f1', 2, { op: '=', value: 'active' });
    p = removeQueryOrRow(removeQueryOrRow(p, 'q', 2), 'q', 1);
    expect(p).toEqual(before);
  });

  it('round-trips through the project format, and is off in projects saved before it', () => {
    const p = setQueryCriteria(addQueryOrRow(grid(), 'q'), 'q', 'f2', 1, { op: '>', value: '10' });
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const saved = JSON.parse(JSON.stringify(grid()));
    delete saved.nodes.find((n: { id: string }) => n.id === 'q').querySpec.orRows;
    expect(spec(parseProject(saved)).orRows).toBe(0);
  });

  it('undo and redo cover adding, editing and removing rows', () => {
    const p0 = grid();
    let h = initHistory(p0);
    h = pushHistory(h, addQueryOrRow(h.present, 'q'));
    const added = h.present;
    h = pushHistory(h, setQueryCriteria(h.present, 'q', 'f2', 1, { op: '>', value: '10' }));
    const edited = h.present;
    h = pushHistory(h, removeQueryOrRow(h.present, 'q', 1));
    expect(spec(h.present).orRows).toBe(0);
    h = undo(h);
    expect(h.present).toEqual(edited);
    h = undo(h);
    expect(h.present).toEqual(added);
    h = undo(h);
    expect(h.present).toEqual(p0);
    h = redo(redo(redo(h)));
    expect(spec(h.present).orRows).toBe(0);
    h = undo(h);
    expect(cells(h.present, 1)).toEqual([undefined, { op: '>', value: '10' }]);
  });
});

describe('query SQL kept from the SQL view', () => {
  it('keeps SQL the grid can’t show beside the design, and discarding it leaves the design as it was', () => {
    const p = addQueryField(twoTables(), 'q', { port: 0, column: 'name' }, undefined, 'f1');
    const kept = setQuerySql(p, 'q', 'SELECT name FROM input1 LIMIT 5');
    expect(spec(kept).sql).toBe('SELECT name FROM input1 LIMIT 5');
    expect(spec(kept).fields).toEqual(spec(p).fields);
    expect(setQuerySql(kept, 'q', 'SELECT name FROM input1 LIMIT 5')).toBe(kept);
    const back = setQuerySql(kept, 'q', undefined);
    expect(spec(back)).toEqual(spec(p));
    expect('sql' in spec(back)).toBe(false);
    // It's saved with the project.
    expect((parseProject(JSON.parse(JSON.stringify(kept))).nodes.find((n) => n.id === 'q') as QueryNode).querySpec.sql).toBe('SELECT name FROM input1 LIMIT 5');
  });

  it('a design read from SQL takes the place of the design and of any SQL kept, as one undo step', () => {
    const kept = setQuerySql(twoTables(), 'q', 'SELECT 1');
    const design = { ...spec(kept), fields: [{ id: 'f9', port: 1, column: 'total', show: true, sort: 'none' as const }] };
    let h = initHistory(kept);
    h = pushHistory(h, setQueryDesign(h.present, 'q', design));
    expect(spec(h.present)).toEqual({ ...spec(twoTables()), fields: design.fields });
    h = undo(h);
    expect(spec(h.present).sql).toBe('SELECT 1');
  });
});
