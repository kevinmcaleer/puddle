import { createProject, useProjectStore } from '../model';
import { addDatabaseFile, databaseDriverFor } from './addFile';
import { useConnectionDialog } from './dialog';
import { connectionFile, resetConnectionFiles } from './files';

beforeEach(() => {
  useProjectStore.getState().load(createProject('Files'));
  resetConnectionFiles();
});

it('knows database files by their extension', () => {
  expect(databaseDriverFor('shop.sqlite')).toBe('sqlite');
  expect(databaseDriverFor('Shop.DB')).toBe('sqlite');
  expect(databaseDriverFor('shop.duckdb')).toBe('duckdb');
  expect(databaseDriverFor('shop.csv')).toBeUndefined();
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
