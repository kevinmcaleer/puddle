// "Add all tables": one Schema table node per table of the schema that has none yet, laid out as the diagram shows
// them, to the right of the flow already on the canvas.
import { addNode, setTableSpec, type Project } from '../model';
import { projectSchema } from '../compiler';
import { layoutDiagram } from '../schema/diagram/geometry';

/** How much further apart nodes sit than the diagram's tables: a node card is wider than its table's box. */
const SPREAD = 1.4;
/** The gap between the flow and the tables added beside it. */
const GAP = 320;

export function addAllSchemaTables(project: Project): { project: Project; added: string[] } {
  const schema = projectSchema(project.schema.dbml);
  const have = new Set(project.nodes.flatMap((n) => (n.type === 'table' ? [`${n.tableSpec.schema}.${n.tableSpec.table}`] : [])));
  const boxes = layoutDiagram(schema, project.schema.positions).tables.filter((b) => !have.has(`${b.table.schema}.${b.table.name}`));
  if (!boxes.length) return { project, added: [] };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const left = project.nodes.length ? Math.max(...project.nodes.map((n) => n.position.x)) + GAP : 0;
  const top = project.nodes.length ? Math.min(...project.nodes.map((n) => n.position.y)) : 0;
  let next = project;
  const added: string[] = [];
  for (const b of boxes) {
    next = addNode(next, 'table', { x: Math.round(left + (b.x - minX) * SPREAD), y: Math.round(top + (b.y - minY) * SPREAD) });
    const id = next.nodes[next.nodes.length - 1]!.id;
    next = setTableSpec(next, id, { schema: b.table.schema, table: b.table.name });
    added.push(id);
  }
  return { project: next, added };
}
