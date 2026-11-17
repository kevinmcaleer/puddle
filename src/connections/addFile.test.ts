import { createProject, useProjectStore } from '../model';
import { readFileSync } from 'node:fs';
import { addDatabaseFile, databaseDriverFor, databaseDriverForFile, databaseDriverOf } from './addFile';
import { useConnectionDialog } from './dialog';
import { connectionFile, resetConnectionFiles } from './files';

beforeEach(() => {
  useProjectStore.getState().load(createProject('Files'));
  resetConnectionFiles();
});
// The shared project runs files in one worker without isolation: leave no files behind for the next file.
afterEach(() => resetConnectionFiles());

it('knows database files by their extension', () => {
  expect(databaseDriverFor('shop.sqlite')).toBe('sqlite');
  expect(databaseDriverFor('Shop.DB')).toBe('sqlite');
  expect(databaseDriverFor('shop.duckdb')).toBe('duckdb');
  expect(databaseDriverFor('places.gpkg')).toBe('sqlite');
  expect(databaseDriverFor('world.mbtiles')).toBe('sqlite');
  expect(databaseDriverFor('shop.csv')).toBeUndefined();
  expect(databaseDriverFor('History')).toBeUndefined();
});

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/db/${name}`));

it('knows database files by their first bytes when the name doesn’t say', async () => {
  expect(databaseDriverOf(fixture('shop.sqlite'))).toBe('sqlite');
  expect(databaseDriverOf(fixture('shop.duckdb'))).toBe('duckdb');
  expect(databaseDriverOf(new TextEncoder().encode('name,age\nAda,36\n'))).toBeUndefined();
  expect(databaseDriverOf(new TextEncoder().encode('SQLite'))).toBeUndefined();
  expect(databaseDriverOf(new Uint8Array())).toBeUndefined();
  // A browser's History file has no extension; an app's .data file has the wrong one.
  expect(await databaseDriverForFile(new File([fixture('shop.sqlite')], 'History'))).toBe('sqlite');
  expect(await databaseDriverForFile(new File([fixture('shop.duckdb')], 'warehouse.data'))).toBe('duckdb');
  expect(await databaseDriverForFile(new File(['a,b\n1,2\n'], 'orders.csv'))).toBeUndefined();
});

it('adds a database file as a connection named after it, keeps the file for the tab, and opens its table picker', () => {
  const file = new File(['x'], 'shop.sqlite');
  const id = addDatabaseFile(file)!;
  const project = useProjectStore.getState().history.present;
  expect(project.connections).toEqual([expect.objectContaining({ id, name: 'shop', driver: 'sqlite', via: 'browser', settings: { file: 'shop.sqlite' } })]);
  expect(connectionFile(id)).toBe(file);
  expect(useConnectionDialog.getState()).toMatchObject({ mode: 'add', pickId: id });
  // A second file of the same name gets the driver's numbered name.
  const again = addDatabaseFile(new File(['y'], 'shop.sqlite'))!;
  expect(useProjectStore.getState().history.present.connections[1]!.name).toBe('SQLite');
  expect(again).not.toBe(id);
  expect(addDatabaseFile(new File([''], 'notes.txt'))).toBeUndefined();
});

it('adds a file its content says is a database under the driver given, named after the whole file name', () => {
  const id = addDatabaseFile(new File(['x'], 'History'), 'sqlite')!;
  expect(useProjectStore.getState().history.present.connections).toEqual([expect.objectContaining({ id, name: 'History', driver: 'sqlite', settings: { file: 'History' } })]);
});
