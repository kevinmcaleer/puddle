// Undo and redo of operations that reach the engine, on real DuckDB-WASM (Node build): files added together are one
// step, and the data a source reads survives undoing edits made before its file was chosen again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addFiles } from '../../src/app/actions';
import { useEngineStore } from '../../src/app/engine';
import { compilePreview } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, useProjectStore } from '../../src/model';
import { reattachFile } from '../../src/sources/attach';
import { createNodeBackend } from '../helpers/nodeBackend';

const text = (name: string) => readFileSync(join(__dirname, '../fixtures', name));
const fixtureFile = (name: string) => new File([text(name)], name);
const rowsIn = (name: string) => text(name).toString('utf8').trim().split('\n').length - 1;

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine });
});
afterAll(() => engine.close());
beforeEach(() => useProjectStore.getState().load(createProject('Undo')));

const project = () => useProjectStore.getState().history.present;
const rowsOf = async (nodeId: string) => tableRows((await engine.query(compilePreview(project(), { nodeId }))).table);

describe('undo with the engine', () => {
  it('adds files chosen together as one undo step, and redo brings them back reading', async () => {
    await addFiles([fixtureFile('customers.csv'), fixtureFile('gaps.csv')]);
    expect(project().sources.map((s) => s.name)).toEqual(['customers.csv', 'gaps.csv']);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().undo();
    expect(project().sources).toEqual([]);
    expect(project().nodes).toEqual([]);

    useProjectStore.getState().redo();
    const [a, b] = project().nodes;
    expect(await rowsOf(a!.id)).toHaveLength(rowsIn('customers.csv'));
    expect(await rowsOf(b!.id)).toHaveLength(rowsIn('gaps.csv'));
  });

  it('keeps reading the file chosen again after undoing an earlier edit', async () => {
    await addFiles([fixtureFile('customers.csv')]);
    const source = project().sources[0]!;
    useProjectStore.getState().apply((p) => ({ ...p, name: 'Renamed' }));
    // The file is chosen again, and it is a different one: recorded as a fact, not an undo step.
    await reattachFile(source, new File([text('gaps.csv')], 'customers.csv'));
    const chosen = project().sources[0]!.file!;
    useProjectStore.getState().undo();
    expect(project().name).toBe('Undo');
    expect(project().sources[0]!.file).toEqual(chosen);
    expect(await rowsOf(project().nodes[0]!.id)).toHaveLength(rowsIn('gaps.csv'));
  });
});
