import { DRIVER_IDS } from '../model';
import { defaultSettings, describeSettings, driver, DRIVERS, missingFields } from './drivers';

describe('drivers', () => {
  it('lists Beekeeper Studio’s 25 databases, each once, each with somewhere to run', () => {
    expect(DRIVERS).toHaveLength(25);
    expect(new Set(DRIVERS.map((d) => d.id)).size).toBe(25);
    expect(DRIVERS.map((d) => d.id).sort()).toEqual([...DRIVER_IDS].sort());
    for (const d of DRIVERS) {
      expect(d.runsIn.length).toBeGreaterThan(0);
      expect(d.monogram).toHaveLength(2);
      expect(new Set(d.fields.map((f) => f.key)).size).toBe(d.fields.length);
    }
    expect(DRIVERS.filter((d) => d.community)).toHaveLength(11);
  });

  it('starts a connection with the driver’s defaults and says which required fields are empty', () => {
    const pg = driver('postgres');
    expect(defaultSettings(pg)).toEqual({ port: 5432, ssl: false, sslVerify: true });
    expect(missingFields(pg, defaultSettings(pg))).toEqual(['Host', 'Database', 'User name']);
    expect(missingFields(pg, { host: 'db', database: 'shop', user: 'kev' })).toEqual([]);
  });

  it('describes a connection in one line', () => {
    expect(describeSettings(driver('postgres'), { host: 'db.local', port: 5432, database: 'shop', user: 'kev' })).toBe('kev@db.local:5432/shop');
    expect(describeSettings(driver('duckdb'), { file: 'shop.duckdb' })).toBe('shop.duckdb');
    expect(describeSettings(driver('clickhouse'), { url: 'https://ch:8443', database: 'default' })).toBe('https://ch:8443');
    expect(describeSettings(driver('bigquery'), { project: 'my-project', dataset: 'sales' })).toBe('my-project/sales');
    expect(describeSettings(driver('postgres'), {})).toBe('PostgreSQL');
  });
});
