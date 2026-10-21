// The databases Puddle connects to, as the connection dialog and the drivers see them. Pure: no driver code here.
// The list is Beekeeper Studio's 25 (plan/phase6-databases.md, section 5); the drivers themselves land family by family.
import type { ConnectionAuth, ConnectionVia, DriverId } from '../model';

/** A field of a driver's settings form. Never a secret: those are asked for separately and kept on the device. */
export interface DriverField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'file';
  /** A hint under the field. */
  hint?: string;
  placeholder?: string;
  /** The value a new connection starts with. */
  default?: string | number | boolean;
  required?: boolean;
  /** Shown (and required) only when the connection runs on one of these routes; every route when absent. */
  when?: ConnectionVia[];
}

export interface Driver {
  id: DriverId;
  label: string;
  /** Two letters shown as the driver's icon on the grid, since logos need their owners' permission. */
  monogram: string;
  /** Where its connections can run. The dialog offers only these. */
  runsIn: ConnectionVia[];
  auth: ConnectionAuth;
  fields: DriverField[];
  /** A line under the driver's name: what it is, or what it needs. */
  note?: string;
  /** Beekeeper lists it in its free edition. Only shown in the docs table. */
  community?: boolean;
}

const host = (defaultPort?: number): DriverField[] => [
  { key: 'host', label: 'Host', kind: 'text', placeholder: 'localhost', required: true },
  ...(defaultPort ? [{ key: 'port', label: 'Port', kind: 'number' as const, default: defaultPort }] : []),
];
const database = (label = 'Database'): DriverField => ({ key: 'database', label, kind: 'text', required: true });
const user: DriverField = { key: 'user', label: 'User name', kind: 'text', required: true };
const ssl: DriverField = { key: 'ssl', label: 'Use SSL', kind: 'boolean', default: false };
/** Whether an SSL connection checks the server's certificate against the trusted authorities; off for a self-signed one. */
const sslVerify: DriverField = { key: 'sslVerify', label: 'Check the certificate', kind: 'boolean', default: true, hint: 'Off for a self-signed certificate.' };
const file = (label: string): DriverField => ({ key: 'file', label, kind: 'file', hint: 'A file on this computer, read in the browser. Nothing is uploaded.', required: true });
const url = (placeholder: string): DriverField => ({ key: 'url', label: 'Address', kind: 'text', placeholder, required: true });

const SERVICE: ConnectionVia[] = ['local', 'pi'];

export const DRIVERS: Driver[] = [
  { id: 'postgres', label: 'PostgreSQL', monogram: 'Pg', runsIn: SERVICE, auth: 'password', fields: [...host(5432), database(), user, ssl, sslVerify], community: true },
  { id: 'mysql', label: 'MySQL', monogram: 'My', runsIn: SERVICE, auth: 'password', fields: [...host(3306), database(), user, ssl, sslVerify], community: true },
  { id: 'sqlite', label: 'SQLite', monogram: 'SL', runsIn: ['browser', ...SERVICE], auth: 'none', fields: [{ ...file('Database file'), when: ['browser'] }, { key: 'path', label: 'Path of the database file', kind: 'text', placeholder: '/data/shop.sqlite', hint: 'On the computer running puddle-connect, inside the folders it may read.', required: true, when: SERVICE }], note: 'A .sqlite or .db file, read in the browser or by puddle-connect.', community: true },
  { id: 'sqlserver', label: 'SQL Server', monogram: 'MS', runsIn: SERVICE, auth: 'password', fields: [...host(1433), database(), user, { key: 'domain', label: 'Domain', kind: 'text', hint: 'For a Windows login. Empty for a SQL login.' }, { key: 'encrypt', label: 'Encrypt', kind: 'boolean', default: true }], community: true },
  { id: 'redshift', label: 'Amazon Redshift', monogram: 'Rs', runsIn: SERVICE, auth: 'password', fields: [...host(5439), database(), user, { ...ssl, default: true }, sslVerify], community: true },
  { id: 'cockroach', label: 'CockroachDB', monogram: 'Cr', runsIn: SERVICE, auth: 'password', fields: [...host(26257), database(), user, { ...ssl, default: true }, sslVerify], community: true },
  { id: 'mariadb', label: 'MariaDB', monogram: 'Ma', runsIn: SERVICE, auth: 'password', fields: [...host(3306), database(), user, ssl, sslVerify], community: true },
  { id: 'tidb', label: 'TiDB', monogram: 'Ti', runsIn: SERVICE, auth: 'password', fields: [...host(4000), database(), user, { ...ssl, default: true }, sslVerify], community: true },
  { id: 'bigquery', label: 'Google BigQuery', monogram: 'BQ', runsIn: ['browser', ...SERVICE], auth: 'oauth', fields: [{ key: 'project', label: 'Project', kind: 'text', required: true }, { key: 'dataset', label: 'Dataset', kind: 'text', hint: 'Empty lists every dataset.' }], note: 'Signs in with Google in the browser; a service-account key on the Pi.', community: true },
  { id: 'redis', label: 'Redis', monogram: 'Rd', runsIn: ['browser', ...SERVICE], auth: 'password', fields: [...host(6379), { key: 'db', label: 'Database number', kind: 'number', default: 0 }, { ...user, required: false }, { key: 'rest', label: 'Upstash REST address', kind: 'text', hint: 'In the browser, a Redis with a REST interface (Upstash) is read directly; the token is the secret.' }], community: true },
  { id: 'greengage', label: 'GreengageDB', monogram: 'Gg', runsIn: SERVICE, auth: 'password', fields: [...host(5432), database(), user, ssl, sslVerify], community: true },
  { id: 'oracle', label: 'Oracle Database', monogram: 'Or', runsIn: SERVICE, auth: 'password', fields: [...host(1521), { key: 'service', label: 'Service name', kind: 'text', required: true }, user] },
  { id: 'cassandra', label: 'Cassandra', monogram: 'Ca', runsIn: SERVICE, auth: 'password', fields: [...host(9042), { key: 'keyspace', label: 'Keyspace', kind: 'text' }, { key: 'datacenter', label: 'Local data centre', kind: 'text', default: 'datacenter1' }, { ...user, required: false }] },
  { id: 'scylla', label: 'ScyllaDB', monogram: 'Sc', runsIn: SERVICE, auth: 'password', fields: [...host(9042), { key: 'keyspace', label: 'Keyspace', kind: 'text' }, { key: 'datacenter', label: 'Local data centre', kind: 'text', default: 'datacenter1' }, { ...user, required: false }] },
  { id: 'firebird', label: 'Firebird', monogram: 'Fb', runsIn: SERVICE, auth: 'password', fields: [...host(3050), database('Database path'), { ...user, default: 'SYSDBA' }] },
  { id: 'libsql', label: 'LibSQL / Turso', monogram: 'Tu', runsIn: ['browser'], auth: 'token', fields: [url('libsql://your-db.turso.io'), { key: 'file', label: 'Or a database file', kind: 'file', hint: 'A LibSQL file is a SQLite file, read in the browser.' }], note: 'Turso over HTTPS, or a local file.' },
  { id: 'clickhouse', label: 'ClickHouse', monogram: 'CH', runsIn: ['browser', ...SERVICE], auth: 'password', fields: [url('https://host:8443'), database(), { ...user, default: 'default' }], note: 'Its HTTP interface lets a browser in, so no service is needed.' },
  { id: 'duckdb', label: 'DuckDB', monogram: 'Dk', runsIn: ['browser'], auth: 'none', fields: [file('Database file')], note: 'A .duckdb file, attached read-only in the browser.' },
  { id: 'sqlanywhere', label: 'SQL Anywhere', monogram: 'SA', runsIn: ['pi'], auth: 'password', fields: [...host(2638), { key: 'server', label: 'Server name', kind: 'text' }, database(), user], note: 'Needs SAP’s client on the Pi.' },
  { id: 'mongodb', label: 'MongoDB', monogram: 'Mg', runsIn: SERVICE, auth: 'password', fields: [url('mongodb://host:27017 or mongodb+srv://…'), database(), { ...user, required: false }] },
  { id: 'trino', label: 'Trino / Presto', monogram: 'Tr', runsIn: ['browser', ...SERVICE], auth: 'password', fields: [url('https://host:8443'), { key: 'catalog', label: 'Catalog', kind: 'text' }, { key: 'schema', label: 'Schema', kind: 'text' }, user], note: 'In the browser only when the cluster allows this site.' },
  { id: 'surrealdb', label: 'SurrealDB', monogram: 'Su', runsIn: ['browser', ...SERVICE], auth: 'password', fields: [url('https://host:8000'), { key: 'namespace', label: 'Namespace', kind: 'text', required: true }, database(), user] },
  { id: 'dynamodb', label: 'DynamoDB', monogram: 'Dy', runsIn: ['browser', ...SERVICE], auth: 'aws', fields: [{ key: 'region', label: 'Region', kind: 'text', placeholder: 'eu-west-2', required: true }, { key: 'accessKeyId', label: 'Access key id', kind: 'text', required: true }, { key: 'endpoint', label: 'Endpoint', kind: 'text', hint: 'Only for DynamoDB Local.' }], note: 'The secret access key is the secret.' },
  { id: 'snowflake', label: 'Snowflake', monogram: 'Sf', runsIn: SERVICE, auth: 'keypair', fields: [{ key: 'account', label: 'Account', kind: 'text', placeholder: 'xy12345.eu-west-2', required: true }, user, { key: 'warehouse', label: 'Warehouse', kind: 'text' }, database(), { key: 'schema', label: 'Schema', kind: 'text' }, { key: 'role', label: 'Role', kind: 'text' }], note: 'Signs in with a private key.' },
  { id: 'hana', label: 'SAP HANA', monogram: 'HA', runsIn: SERVICE, auth: 'password', fields: [...host(39015), database('Database'), user, { ...ssl, default: true }], note: 'Beekeeper lists it as coming soon.' },
];

const byId = new Map(DRIVERS.map((d) => [d.id, d]));
export const driver = (id: DriverId): Driver => byId.get(id)!;

/** What a driver's secret is called on the sign-in field, or nothing when it needs none. */
export const SECRET_LABEL: Record<ConnectionAuth, string | undefined> = {
  password: 'Password',
  token: 'Token',
  keypair: 'Private key',
  aws: 'Secret access key',
  oauth: undefined,
  none: undefined,
};

export const VIA_LABEL: Record<ConnectionVia, string> = { browser: 'In the browser', local: 'On this computer', pi: 'On the Pi' };

/** A driver's settings as a new connection starts with them. */
export function defaultSettings(d: Driver): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of d.fields) if (f.default !== undefined) out[f.key] = f.default;
  return out;
}

/** The fields a connection shows on its route. */
export const fieldsFor = (d: Driver, via: ConnectionVia): DriverField[] => d.fields.filter((f) => !f.when || f.when.includes(via));

/** The required fields of a driver that are still empty, by label. */
export function missingFields(d: Driver, settings: Record<string, string | number | boolean>, via: ConnectionVia = 'browser'): string[] {
  return fieldsFor(d, via).filter((f) => f.required && (settings[f.key] === undefined || settings[f.key] === '')).map((f) => f.label);
}

/** A connection's settings as one line for lists: "kev@db.local:5432/shop", "shop.duckdb", or the address. */
export function describeSettings(d: Driver, settings: Record<string, string | number | boolean>): string {
  const s = (k: string) => (settings[k] === undefined || settings[k] === '' ? undefined : String(settings[k]));
  if (s('path')) return s('path')!;
  if (s('file')) return s('file')!;
  if (s('url')) return s('url')!;
  const where = s('host') ? `${s('host')}${s('port') ? `:${s('port')}` : ''}` : s('account') ?? s('project') ?? s('region') ?? '';
  const db = s('database') ?? s('service') ?? s('keyspace') ?? s('dataset') ?? '';
  const who = s('user');
  return `${who ? `${who}@` : ''}${where}${db ? `/${db}` : ''}` || d.label;
}
