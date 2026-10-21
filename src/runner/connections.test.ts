import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import type { Connection, DriverId, Source } from '../model';
import { connectionFileCandidates, describeConnectionSource, leakMessage, leakedSecrets, placeConnection, secretsFrom, secretVariable, type PlaceOptions } from './connections';
import { placeSources } from './sources';

const connection = (over: Partial<Connection> = {}): Connection => ({ id: 'c1', name: 'Shop DB', driver: 'postgres', via: 'pi', settings: { host: 'db.local', port: 5432, database: 'shop', user: 'puddle' }, auth: 'password', ...over });
const source = (connectionId = 'c1', over: Partial<Source['connection']> = {}): Source => ({ ...src({ id: 's1', format: 'connection' }), name: 'orders', kind: 'connection', connection: { connectionId, columns: [], table: { schema: 'public', name: 'orders' }, ...over } });
const served = new Set<DriverId>(['postgres', 'sqlite', 'libsql', 'mysql']);
const options = (env: Record<string, string | undefined> = {}, file = '{}'): PlaceOptions => ({ secretOf: secretsFrom(env, () => file), served, env });

describe('secrets for the runner', () => {
  it('names the variable a connection’s secret comes in from its name', () => {
    expect(secretVariable('Shop DB')).toBe('PUDDLE_SECRET_SHOP_DB');
    expect(secretVariable('  orders (prod) — eu  ')).toBe('PUDDLE_SECRET_ORDERS_PROD_EU');
    expect(secretVariable('café')).toBe('PUDDLE_SECRET_CAFE');
  });

  it('takes the variable first, then the file by name, then by id, and says when the file is wrong', () => {
    const c = connection();
    expect(secretsFrom({ PUDDLE_SECRET_SHOP_DB: 'from-env' }, () => '{"Shop DB":"from-file"}')(c)).toBe('from-env');
    expect(secretsFrom({ PUDDLE_SECRETS: '/run/secrets.json' }, () => '{"Shop DB":"from-file"}')(c)).toBe('from-file');
    expect(secretsFrom({ PUDDLE_SECRETS: '/run/secrets.json' }, () => '{"c1":"by-id"}')(c)).toBe('by-id');
    expect(secretsFrom({ PUDDLE_SECRETS: '/run/secrets.json' }, () => '{"other":"x"}')(c)).toBeUndefined();
    // An empty variable is an empty sign-in, as the browser allows for an open server.
    expect(secretsFrom({ PUDDLE_SECRET_SHOP_DB: '' }, () => '{}')(c)).toBe('');
    expect(secretsFrom({}, () => { throw new Error('never read'); })(c)).toBeUndefined();
    expect(() => secretsFrom({ PUDDLE_SECRETS: '/nope.json' }, () => { throw new Error('ENOENT'); })(c)).toThrow('PUDDLE_SECRETS names /nope.json, which can’t be read (ENOENT).');
    expect(() => secretsFrom({ PUDDLE_SECRETS: '/bad.json' }, () => 'not json')(c)).toThrow('isn’t JSON');
    expect(() => secretsFrom({ PUDDLE_SECRETS: '/list.json' }, () => '["a"]')(c)).toThrow('must hold a JSON object');
  });

  it('finds a secret written into a connection’s settings, whatever the key is called, and refuses the project', () => {
    const clean = { connections: [connection()] };
    expect(leakedSecrets(clean)).toEqual([]);
    const leaky = { connections: [connection({ settings: { host: 'h', password: 'hunter2' } }), connection({ id: 'c2', name: 'Keys', settings: { accessKeyId: 'AKID', secret_access_key: 'shh' } }), connection({ id: 'c3', name: 'Empty', settings: { password: '' } })] };
    expect(leakedSecrets(leaky).map((l) => [l.connection.name, l.key])).toEqual([
      ['Shop DB', 'password'],
      ['Keys', 'secret_access_key'],
    ]);
    expect(leakMessage(leakedSecrets(leaky).slice(0, 1))).toBe('connection “Shop DB” has a password in its settings. Puddle never writes a secret into a project file: take it out and give it through PUDDLE_SECRET_SHOP_DB or the PUDDLE_SECRETS file.');
    expect(leakMessage(leakedSecrets(leaky))).toContain('PUDDLE_SECRET_<NAME>');
  });
});

describe('placing connection sources', () => {
  const project = (c: Connection = connection()) => ({ connections: [c] });

  it('places a server connection with its secret, and says what is missing otherwise', () => {
    const s = source();
    expect(placeConnection(s, project(), '/p', () => false, options({ PUDDLE_SECRET_SHOP_DB: 'pw' }))).toEqual({ place: { connection: connection(), secret: 'pw', secretFrom: 'variable' } });
    expect(placeConnection(s, project(), '/p', () => false, options({ PUDDLE_SECRETS: '/s.json' }, '{"Shop DB":"pw"}'))).toMatchObject({ place: { secret: 'pw', secretFrom: 'file' } });
    expect(placeConnection(s, project(), '/p', () => false, options())).toEqual({ reason: 'needs the password of connection “Shop DB”: set PUDDLE_SECRET_SHOP_DB, or add "Shop DB" to the PUDDLE_SECRETS file' });
    expect(placeConnection(source('gone'), project(), '/p', () => false, options())).toEqual({ reason: 'reads a connection that was removed from the project' });
    expect(placeConnection(s, project(connection({ driver: 'duckdb', auth: 'none', settings: { file: 'shop.duckdb' } })), '/p', () => true, options())).toEqual({ reason: 'reads a DuckDB database through connection “Shop DB”, which the runner can’t reach yet' });
    expect(placeConnection(s, project(connection({ driver: 'mysql', auth: 'none' })), '/p', () => false, options())).toMatchObject({ place: { secretFrom: 'none needed' } });
  });

  it('finds a file connection’s database by its runner path, or by the picked file’s name beside the project, inside the project’s folder only', () => {
    const sqlite = (settings: Connection['settings']) => connection({ driver: 'sqlite', via: 'browser', auth: 'none', settings });
    expect(connectionFileCandidates(sqlite({ file: 'shop.sqlite' }), '/p')).toEqual(['/p/shop.sqlite', '/p/sources/shop.sqlite']);
    expect(connectionFileCandidates(sqlite({ path: 'data/shop.sqlite', file: 'shop.sqlite' }), '/p')).toEqual(['/p/data/shop.sqlite', '/p/shop.sqlite', '/p/sources/shop.sqlite']);
    expect(connectionFileCandidates(sqlite({ path: '/srv/shop.sqlite', file: '../../etc/passwd' }), '/p')).toEqual(['/srv/shop.sqlite', '/p/passwd', '/p/sources/passwd']);
    const s = source();
    const found = placeConnection(s, project(sqlite({ file: 'shop.sqlite' })), '/p', (path) => path === '/p/sources/shop.sqlite', options());
    expect(found).toMatchObject({ place: { connection: { settings: { file: 'shop.sqlite', path: '/p/sources/shop.sqlite' } }, secretFrom: 'none needed' } });
    expect(placeConnection(s, project(sqlite({ file: 'shop.sqlite' })), '/p', () => false, options())).toEqual({ reason: 'reads connection “Shop DB”, whose file was not found at /p/shop.sqlite or /p/sources/shop.sqlite' });
    expect(placeConnection(s, project(sqlite({ path: '/etc/shop.sqlite' })), '/p', () => true, options())).toEqual({ reason: 'reads connection “Shop DB”, whose file /etc/shop.sqlite is outside the project’s folder /p' });
    expect(placeConnection(s, project(sqlite({})), '/p', () => true, options())).toEqual({ reason: 'reads connection “Shop DB”, which names no database file' });
    // A LibSQL connection with an address is a server, not a file.
    const turso = connection({ driver: 'libsql', auth: 'token', settings: { url: 'libsql://x.turso.io' } });
    expect(placeConnection(s, project(turso), '/p', () => false, options({ PUDDLE_SECRET_SHOP_DB: 't' }))).toMatchObject({ place: { secret: 't' } });
  });

  it('describes what a placed source reads, and placeSources carries connection sources through', () => {
    const place = { connection: connection(), secret: 'pw', secretFrom: 'variable' as const };
    expect(describeConnectionSource(source(), place)).toBe('table public.orders of connection “Shop DB” (PostgreSQL, secret from PUDDLE_SECRET_SHOP_DB)');
    expect(describeConnectionSource(source('c1', { table: undefined, query: 'SELECT 1' }), { ...place, secretFrom: 'file' })).toBe('a query of connection “Shop DB” (PostgreSQL, secret from PUDDLE_SECRETS)');
    const p = { ...flow({ sources: [source()], nodes: [] }), connections: [connection()] };
    const parsed = p.sources[0]!;
    expect(placeSources(p, '/p', () => false)).toEqual([{ source: parsed, reason: 'reads a database, which this runner was given no secrets or drivers for' }]);
    expect(placeSources(p, '/p', () => false, options({ PUDDLE_SECRET_SHOP_DB: 'pw' }))).toEqual([{ source: parsed, path: '', connection: place }]);
    expect(placeSources(p, '/p', () => false, options())).toEqual([{ source: parsed, reason: expect.stringContaining('needs the password') }]);
  });
});
