import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { inputEdges, nodeById, type Project } from '../model';
import { planShellChange, tableNodeOf, type ShellChangePlan } from './shellChange';

const base = flow({
  sources: [src({ id: 'o', format: 'csv' })],
  nodes: [{ id: 'o', type: 'source', sourceId: 'o', name: 'orders' }],
  wires: [],
});

const planned = (project: Project, statements: string[], hostId?: string): ShellChangePlan => {
  const plan = planShellChange(project, statements, 'o', hostId);
  if ('problem' in plan) throw new Error(plan.problem);
  return plan;
};
const scriptOf = (plan: ShellChangePlan) => {
  const n = nodeById(plan.project, plan.hostId);
  return n?.type === 'sql' ? n.sqlSpec.query : undefined;
};

describe('where the shell keeps a table it makes or changes', () => {
  it('makes a new table in a new SQL node, wired from the viewed node only when it reads input, with the table’s node', () => {
    const plan = planned(base, ['CREATE TABLE big AS SELECT * FROM input WHERE total > 5']);
    expect(plan).toMatchObject({ created: true, touched: [{ table: 'big', change: 'create' }] });
    expect(scriptOf(plan)).toBe('CREATE TABLE big AS SELECT * FROM input WHERE total > 5');
    expect(inputEdges(plan.project, plan.hostId).map((e) => e.from.nodeId)).toEqual(['o']);
    expect(tableNodeOf(plan.project, plan.hostId, 'BIG')).toBeDefined();

    const free = planned(base, ["CREATE TABLE sizes (size VARCHAR)", "INSERT INTO sizes VALUES ('S')"]);
    expect(inputEdges(free.project, free.hostId)).toEqual([]);
    expect(scriptOf(free)).toBe("CREATE TABLE sizes (size VARCHAR);\nINSERT INTO sizes VALUES ('S')");
  });

  it('adds later tables to the shell’s SQL node, and a change to the script that makes the table', () => {
    const first = planned(base, ['CREATE TABLE notes (id INTEGER)']);
    const second = planned(first.project, ['CREATE TABLE tags AS SELECT * FROM orders'], first.hostId);
    expect(second).toMatchObject({ created: false, hostId: first.hostId });
    expect(scriptOf(second)).toBe('CREATE TABLE notes (id INTEGER);\nCREATE TABLE tags AS SELECT * FROM orders');
    // orders is read by name: wired in for it.
    expect(inputEdges(second.project, first.hostId).map((e) => e.from.nodeId)).toEqual(['o']);
    // A change finds the script that makes its table, whatever the shell's own node is now.
    const third = planned(second.project, ['UPDATE notes SET id = 2'], undefined);
    expect(third).toMatchObject({ created: false, hostId: first.hostId, touched: [{ table: 'notes', change: 'update' }] });
    expect(scriptOf(third)).toMatch(/;\nUPDATE notes SET id = 2$/);
  });

  it('starts a new node when the statements read input and the shell’s node isn’t wired from the viewed one', () => {
    const first = planned(base, ['CREATE TABLE notes (id INTEGER)']);
    const second = planned(first.project, ['CREATE TABLE big AS SELECT * FROM input'], first.hostId);
    expect(second.created).toBe(true);
    expect(second.hostId).not.toBe(first.hostId);
  });

  it('drops a table and its node, renames one and its node', () => {
    const made = planned(base, ['CREATE TABLE a AS SELECT 1 AS x', 'CREATE TABLE b AS SELECT 2 AS y']);
    const dropped = planned(made.project, ['DROP TABLE a']);
    expect(tableNodeOf(dropped.project, made.hostId, 'a')).toBeUndefined();
    expect(tableNodeOf(dropped.project, made.hostId, 'b')).toBeDefined();
    const renamed = planned(dropped.project, ['ALTER TABLE b RENAME TO c']);
    expect(renamed.touched).toEqual([{ table: 'c', change: 'rename', from: 'b' }]);
    const node = tableNodeOf(renamed.project, made.hostId, 'c');
    expect(node && nodeById(renamed.project, node)?.name).toBe('c');
  });

  it('says why when a statement can’t go anywhere', () => {
    expect(planShellChange(base, ['UPDATE orders SET total = 0'], 'o', undefined)).toEqual({ problem: expect.stringMatching(/^orders is a node of the project, which the shell reads but can’t change: make a table of your own from it first, CREATE TABLE my_orders AS SELECT \* FROM orders/) });
    expect(planShellChange(base, ['DELETE FROM nowhere'], 'o', undefined)).toEqual({ problem: expect.stringMatching(/there’s no table nowhere/) });
    expect(planShellChange(base, ['CREATE TABLE orders AS SELECT 1'], 'o', undefined)).toEqual({ problem: 'orders is already the name of a node: give the table another name' });
    const made = planned(base, ['CREATE TABLE a AS SELECT 1 AS x']);
    expect(planShellChange(made.project, ['CREATE TABLE a AS SELECT 2 AS x'], 'o', made.hostId)).toEqual({ problem: 'a already exists: write CREATE OR REPLACE TABLE a to make it again' });
    expect(planned(made.project, ['CREATE OR REPLACE TABLE a AS SELECT 2 AS x'], made.hostId).touched).toEqual([{ table: 'a', change: 'replace' }]);
    expect(planShellChange(made.project, ['INSERT INTO a SELECT * FROM nope'], 'o', made.hostId)).toEqual({ problem: expect.stringMatching(/no table nope/) });
  });
});
