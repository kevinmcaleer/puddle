import { createProject } from '../model';
import { copyConnection, defaultVia, newConnection } from './form';

describe('connection form', () => {
  it('starts in the browser where the driver allows it, else on whichever service answers', () => {
    expect(defaultVia('sqlite', {})).toBe('browser');
    expect(defaultVia('clickhouse', { pi: true })).toBe('browser');
    expect(defaultVia('postgres', {})).toBe('local');
    expect(defaultVia('postgres', { pi: true })).toBe('pi');
    expect(defaultVia('postgres', { local: true, pi: true })).toBe('local');
    expect(defaultVia('sqlanywhere', { local: true })).toBe('pi');
  });

  it('makes a connection with the driver’s defaults and a free name', () => {
    const p = createProject('x');
    const c = newConnection(p, 'postgres', {});
    expect(c).toMatchObject({ name: 'PostgreSQL', driver: 'postgres', via: 'local', settings: { port: 5432, ssl: false }, auth: 'password' });
    expect(c.id).toMatch(/^c/);
  });

  it('copies a connection from another project with a new id and no catalogue', () => {
    const p = createProject('x');
    const from = { ...newConnection(p, 'mysql', {}), id: 'c-old', settings: { host: 'db', database: 'shop', user: 'kev' }, catalog: { tables: [] }, catalogAt: '2026-10-20' };
    const copy = copyConnection({ ...p, connections: [{ ...from, id: 'c1' }] }, from);
    expect(copy.id).not.toBe('c-old');
    expect(copy.name).toBe('MySQL 2');
    expect(copy.settings).toEqual(from.settings);
    expect(copy.catalog).toBeUndefined();
  });
});
