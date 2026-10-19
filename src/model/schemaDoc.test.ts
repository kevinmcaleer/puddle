import { createProject, parseProject } from '.';
import { editSchema, moveSchemaElements, setSchemaDbml } from './schemaDoc';

describe('the project schema document', () => {
  it('starts empty, and a project saved before it existed opens with an empty one', () => {
    const p = createProject('p');
    expect(p.schema).toEqual({ dbml: '', positions: {} });
    const { schema: _schema, ...older } = p;
    expect(parseProject(JSON.parse(JSON.stringify(older))).schema).toEqual({ dbml: '', positions: {} });
  });

  it('keeps the DBML and positions through a save and reopen', () => {
    let p = setSchemaDbml(createProject('p'), 'Table users {\n  id int\n}\n');
    p = moveSchemaElements(p, { 'table:public.users': { x: 40, y: 80 } });
    expect(parseProject(JSON.parse(JSON.stringify(p))).schema).toEqual({ dbml: 'Table users {\n  id int\n}\n', positions: { 'table:public.users': { x: 40, y: 80 } } });
  });

  it('returns the same project when nothing changes, so no undo step is made', () => {
    const p = setSchemaDbml(createProject('p'), 'x');
    expect(setSchemaDbml(p, 'x')).toBe(p);
    const q = moveSchemaElements(p, { a: { x: 1, y: 2 } });
    expect(moveSchemaElements(q, { a: { x: 1, y: 2 } })).toBe(q);
    expect(moveSchemaElements(q, { b: { x: 0, y: 0 } }).schema.positions).toEqual({ a: { x: 1, y: 2 }, b: { x: 0, y: 0 } });
  });
});

describe('an edit made on the diagram', () => {
  it('changes the text, moves a renamed table’s place and its Schema table nodes, and places new elements, in one step', () => {
    const base = createProject('p');
    const p = parseProject({
      ...base,
      schema: { dbml: 'Table users {\n  id int\n}', positions: { 'table:public.users': { x: 10, y: 20 } } },
      nodes: [{ id: 'n', type: 'table', name: 'users', position: { x: 0, y: 0 }, rules: [], tableSpec: { schema: 'public', table: 'users', examples: true, mapping: {} } }],
    });
    const next = editSchema(p, 'Table people {\n  id int\n}', { renamed: { from: 'table:public.users', to: 'table:public.people' }, places: { 'note:n1': { x: 5, y: 5 } } });
    expect(next.schema).toEqual({ dbml: 'Table people {\n  id int\n}', positions: { 'table:public.people': { x: 10, y: 20 }, 'note:n1': { x: 5, y: 5 } } });
    expect(next.nodes[0]).toMatchObject({ tableSpec: { schema: 'public', table: 'people' } });
  });
});
