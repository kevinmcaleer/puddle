import { describe, expect, it } from 'vitest';
import { addNode, createProject, setSchemaCheck, setSchemaDbml, useProjectStore, type Project } from '../model';
import { loadIntoSchemaTable } from './actions';
import { useSession } from './session';

const present = () => useProjectStore.getState().history.present;
const DBML = 'Table customers {\n  id int [pk]\n}\nTable people {\n  id int [pk]\n}';

function load(prepare: (p: Project, id: string) => Project = (p) => p) {
  let p: Project = setSchemaDbml(createProject('Load'), DBML);
  p = addNode(p, 'transform', { x: 0, y: 0 });
  useProjectStore.getState().load(prepare(p, p.nodes[0]!.id));
  useSession.setState({ selectedNodeId: null, selectedNodeIds: [], connectFrom: null, notice: null, designerNodeId: null });
  return p.nodes[0]!.id;
}

describe('loading into a schema table', () => {
  it('checks the rows going in against the table, undone with the load as one step', () => {
    const from = load();
    loadIntoSchemaTable(from, 'public', 'customers');
    const node = present().nodes.find((n) => n.id === from)!;
    expect(node.schemaCheck).toEqual({ schema: 'public', table: 'customers', mapping: {} });
    expect(node.rules.some((r) => r.id === 'schema-unique-id')).toBe(true);
    useProjectStore.getState().undo();
    expect(present().nodes).toHaveLength(1);
    expect(present().nodes[0]!.schemaCheck).toBeUndefined();
  });

  it('keeps a check the node already has', () => {
    const from = load((p, id) => setSchemaCheck(p, id, { schema: 'public', table: 'people', mapping: {} }));
    loadIntoSchemaTable(from, 'public', 'customers');
    expect(present().nodes.find((n) => n.id === from)!.schemaCheck?.table).toBe('people');
  });
});
