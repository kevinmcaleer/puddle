import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from '../app/session';
import { addNode, createProject, inputEdges, useProjectStore, type Project } from '../model';
import { makeSqlNode } from './actions';

const present = () => useProjectStore.getState().history.present;

beforeEach(() => {
  let p: Project = createProject('Console');
  p = addNode(p, 'transform', { x: 0, y: 0 });
  useProjectStore.getState().load(p);
  useSession.setState({ selectedNodeId: null, selectedNodeIds: [], inspectorTab: 'project' });
});

describe('making a SQL node from the console', () => {
  it('adds one after the viewed node, wired to it, with the query, selected and viewed, as one undo step', () => {
    const viewed = present().nodes[0]!;
    const added = makeSqlNode(viewed.id, 'SELECT count(*) AS n FROM input');
    const sql = present().nodes.find((n) => n.id === added);
    expect(sql?.type).toBe('sql');
    expect(sql?.type === 'sql' && sql.sqlSpec.query).toBe('SELECT count(*) AS n FROM input');
    expect(sql!.position.x).toBeGreaterThan(viewed.position.x);
    expect(inputEdges(present(), added!).map((e) => e.from.nodeId)).toEqual([viewed.id]);
    expect(useSession.getState().selectedNodeId).toBe(added);
    expect(useSession.getState().inspectorTab).toBe('node');
    expect(present().view.viewedNodeId).toBe(added);
    useProjectStore.getState().undo();
    expect(present().nodes).toHaveLength(1);
  });
});
