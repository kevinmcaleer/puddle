import { describe, expect, it } from 'vitest';
import { parseProject, setTableSpec, type Project } from '../model';
import { flow } from '../../tests/helpers/projects';
import { addAllSchemaTables } from './place';

const DBML = 'Table customers {\n  id int [pk]\n}\nTable orders {\n  id int [pk]\n  customer_id int [ref: > customers.id]\n}\nTable notes {\n  id int\n}';
const withDbml = (p: Project, positions = {}) => parseProject({ ...p, schema: { dbml: DBML, positions } });

describe('adding every schema table', () => {
  it('adds a node per table, named after it, laid out as the diagram has them', () => {
    const p = withDbml(flow({ nodes: [] }), { 'table:public.customers': { x: 100, y: 100 }, 'table:public.orders': { x: 500, y: 100 }, 'table:public.notes': { x: 100, y: 400 } });
    const { project, added } = addAllSchemaTables(p);
    expect(added).toHaveLength(3);
    const nodes = project.nodes.map((n) => [n.name, n.type === 'table' ? n.tableSpec.table : '', n.position]);
    expect(nodes).toEqual([
      ['customers', 'customers', { x: 0, y: 0 }],
      ['orders', 'orders', { x: 560, y: 0 }],
      ['notes', 'notes', { x: 0, y: 420 }],
    ]);
  });

  it('skips tables that already have a node, and sits beside the flow', () => {
    const p = withDbml(flow({ nodes: [{ id: 'c', type: 'table', tableSpec: { table: 'customers' } }] }));
    const moved = { ...p, nodes: p.nodes.map((n) => ({ ...n, position: { x: 40, y: 80 } })) };
    const { project, added } = addAllSchemaTables(moved);
    expect(added).toHaveLength(2);
    expect(project.nodes.slice(1).every((n) => n.position.x >= 360 && n.position.y >= 80)).toBe(true);
    expect(addAllSchemaTables(project).added).toEqual([]);
  });
});

describe('pointing a node at a table', () => {
  it('names a default-named node after its table, keeps a name given by hand, and drops a stale mapping', () => {
    const p = flow({ nodes: [{ id: 'a', type: 'table', tableSpec: { table: '' } }, { id: 'b', type: 'table', tableSpec: { table: 'orders', mapping: { id: 'x' } } }] });
    const named = parseProject({ ...p, nodes: p.nodes.map((n) => (n.id === 'a' ? { ...n, name: 'Table 1' } : { ...n, name: 'Landed orders' })) });
    const next = setTableSpec(setTableSpec(named, 'a', { table: 'customers' }), 'b', { table: 'customers' });
    expect(next.nodes.map((n) => [n.name, n.type === 'table' && n.tableSpec])).toEqual([
      ['customers', { schema: 'public', table: 'customers', examples: true, mapping: {} }],
      ['Landed orders', { schema: 'public', table: 'customers', examples: true, mapping: {} }],
    ]);
    // A second node for the same table gets a number.
    const again = setTableSpec(parseProject({ ...next, nodes: [...next.nodes, { ...next.nodes[0]!, id: 'c', name: 'Table 2' }] }), 'c', { table: 'customers' });
    expect(again.nodes[2]!.name).toBe('customers 2');
  });
});
