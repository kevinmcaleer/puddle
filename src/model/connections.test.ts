import { createProject, parseProject, type Connection, type Source } from '.';
import { addConnection, connectionSources, nextConnectionName, removeConnection, updateConnection } from './connections';

const conn = (id: string, name = 'Shop'): Connection => ({ id, name, driver: 'postgres', via: 'local', settings: { host: 'db.local', port: 5432, database: 'shop', user: 'kev' }, auth: 'password' });

describe('connections', () => {
  it('adds, replaces by id, updates and removes', () => {
    let p = addConnection(createProject('x'), conn('c1'));
    p = addConnection(p, conn('c1', 'Shop renamed'));
    expect(p.connections).toHaveLength(1);
    expect(p.connections[0]!.name).toBe('Shop renamed');
    p = updateConnection(p, 'c1', { via: 'pi' });
    expect(p.connections[0]!.via).toBe('pi');
    expect(removeConnection(p, 'c1').connections).toEqual([]);
  });

  it('keeps a connection a source reads through', () => {
    const source: Source = { id: 's1', name: 'orders', kind: 'connection', connection: { connectionId: 'c1', table: { name: 'orders' }, columns: [] }, format: 'connection', parseOptions: {}, detectedSchema: [] };
    const p = { ...addConnection(createProject('x'), conn('c1')), sources: [source] };
    expect(connectionSources(p, 'c1')).toHaveLength(1);
    expect(removeConnection(p, 'c1').connections).toHaveLength(1);
  });

  it('names the next connection after the driver', () => {
    const p = addConnection(createProject('x'), conn('c1', 'PostgreSQL'));
    expect(nextConnectionName(p, 'PostgreSQL')).toBe('PostgreSQL 2');
    expect(nextConnectionName(p, 'MySQL')).toBe('MySQL');
  });

  it('round-trips through the project schema with no secret field to hold one', () => {
    const p = parseProject(JSON.parse(JSON.stringify(addConnection(createProject('x'), conn('c1')))));
    expect(p.connections[0]).toEqual(conn('c1'));
    expect(Object.keys(p.connections[0]!)).not.toContain('password');
  });
});
