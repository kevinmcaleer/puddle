// The connector for a connection, as the browser reaches it: a driver loaded on first use for a connection that
// runs in the page, or the service's routes for one that runs in puddle-connect.
import type { Connection, DriverId } from '../model';
import { remoteConnector } from './remote';
import { ConnectorError, type Connector } from './types';

/** The drivers that run in the browser, loaded only when a connection first needs them. */
const BROWSER: Partial<Record<DriverId, () => Promise<{ default: Connector }>>> = {
  sqlite: () => import('./drivers/sqlite'),
  libsql: () => import('./drivers/libsql'),
  duckdb: () => import('./drivers/duckdb'),
  clickhouse: () => import('./drivers/clickhouse'),
  trino: () => import('./drivers/trino'),
  bigquery: () => import('./drivers/bigquery'),
  surrealdb: () => import('./drivers/surrealdb'),
  dynamodb: () => import('./drivers/dynamodb'),
};

const loaded = new Map<DriverId, Promise<Connector>>();

export const hasBrowserDriver = (id: DriverId) => id in BROWSER;

export function connectorFor(connection: Pick<Connection, 'driver' | 'via'>): Promise<Connector> {
  if (connection.via !== 'browser') return Promise.resolve(remoteConnector(connection.via));
  const load = BROWSER[connection.driver];
  if (!load) return Promise.reject(new ConnectorError(`Reading ${connection.driver} in the browser isn’t built yet.`));
  let p = loaded.get(connection.driver);
  if (!p) {
    p = load().then((m) => m.default);
    loaded.set(connection.driver, p);
  }
  return p;
}

/** Tests: use these connectors instead of loading drivers. */
export function setConnectors(connectors: Partial<Record<DriverId, Connector>> | undefined) {
  loaded.clear();
  if (connectors) for (const [id, c] of Object.entries(connectors)) loaded.set(id as DriverId, Promise.resolve(c!));
}
