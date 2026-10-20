import { connectorFor, hasBrowserDriver, setConnectors } from './browser';

afterEach(() => setConnectors(undefined));

it('loads a browser driver once for file databases, and reaches the service for the rest', async () => {
  expect(hasBrowserDriver('sqlite')).toBe(true);
  expect(hasBrowserDriver('postgres')).toBe(false);
  const a = await connectorFor({ driver: 'sqlite', via: 'browser' });
  expect(a.id).toBe('sqlite');
  expect(await connectorFor({ driver: 'sqlite', via: 'browser' })).toBe(a);
  expect((await connectorFor({ driver: 'duckdb', via: 'browser' })).id).toBe('duckdb');
  expect((await connectorFor({ driver: 'libsql', via: 'browser' })).id).toBe('libsql');
  expect((await connectorFor({ driver: 'postgres', via: 'local' })).runsIn).toEqual(['local']);
  await expect(connectorFor({ driver: 'postgres', via: 'browser' })).rejects.toThrow('isn’t built yet');
});
