// Connection sources on the runner: the same drivers puddle-connect runs, in-process, with each connection's secret
// taken from the runner's environment and never from the project file. Pure but for what is passed in (the
// environment, a file reader, whether a path exists), so the placing and the lookups are tested on their own.
import { basename, isAbsolute, join, resolve } from 'node:path';
import { insideFolders } from '../connect/node';
import { driver, SECRET_LABEL } from '../connections/drivers';
import type { Connection, DriverId, Project, Source } from '../model';

/** How a secret is given to the runner: a PUDDLE_SECRET_<NAME> variable, or the PUDDLE_SECRETS JSON file keyed by connection name (or id). */
export type SecretOf = (connection: Pick<Connection, 'id' | 'name'>) => string | undefined;

/** The environment variable a connection's secret may come in: its name upper-cased with runs of anything but letters and digits as one underscore. */
export const secretVariable = (name: string) =>
  `PUDDLE_SECRET_${name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()}`;

/**
 * Secrets from the environment: `PUDDLE_SECRET_<NAME>` wins, then the file `PUDDLE_SECRETS` names, read once, a
 * JSON object of connection name (or id) to secret. A missing or unreadable file is an error the first time a
 * secret is looked up, so a mistyped path never silently leaves every connection signed out.
 */
export function secretsFrom(env: Record<string, string | undefined>, readFile: (path: string) => string): SecretOf {
  let file: Record<string, string> | undefined;
  const fromFile = (): Record<string, string> => {
    if (file) return file;
    const path = env.PUDDLE_SECRETS?.trim();
    if (!path) return (file = {});
    let text: string;
    try {
      text = readFile(path);
    } catch (e) {
      throw new Error(`PUDDLE_SECRETS names ${path}, which can’t be read (${e instanceof Error ? e.message : String(e)}).`);
    }
    // An empty file (compose mounts /dev/null until one is given) holds no secrets.
    if (!text.trim()) return (file = {});
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`PUDDLE_SECRETS (${path}) isn’t JSON. Expected an object like { "shop": "the password" }.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`PUDDLE_SECRETS (${path}) must hold a JSON object of connection name to secret.`);
    file = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string') as [string, string][]);
    return file;
  };
  return (connection) => {
    const variable = env[secretVariable(connection.name)];
    if (variable !== undefined) return variable;
    const secrets = fromFile();
    return secrets[connection.name] ?? secrets[connection.id];
  };
}

/** Setting keys that would hold a secret. The dialog never writes one; a file edited by hand or another tool might. */
const SECRET_KEYS = new Set(['password', 'passwd', 'pwd', 'pass', 'secret', 'token', 'accesstoken', 'secretaccesskey', 'privatekey', 'key', 'passphrase', 'apikey']);

/** Connections whose settings hold a secret, which the runner refuses to run: a secret belongs in its environment, never in a project file. */
export function leakedSecrets(project: Pick<Project, 'connections'>): { connection: Connection; key: string }[] {
  const leaks: { connection: Connection; key: string }[] = [];
  for (const connection of project.connections)
    for (const [key, value] of Object.entries(connection.settings))
      if (SECRET_KEYS.has(key.replace(/[^A-Za-z]/g, '').toLowerCase()) && typeof value === 'string' && value.trim()) leaks.push({ connection, key });
  return leaks;
}

/** The message a project with a secret in it is refused with. */
export const leakMessage = (leaks: { connection: Connection; key: string }[]) =>
  `${leaks.map((l) => `connection “${l.connection.name}” has a ${l.key} in its settings`).join('; ')}. Puddle never writes a secret into a project file: take it out and give it through ${leaks.length === 1 ? secretVariable(leaks[0]!.connection.name) : 'PUDDLE_SECRET_<NAME>'} or the PUDDLE_SECRETS file.`;

/** A connection source placed for a run: its connection with the file path settled, and the secret the run uses. */
export interface ConnectionPlace {
  connection: Connection;
  secret?: string;
  /** Where its secret came from, for `check`. */
  secretFrom?: 'variable' | 'file' | 'none needed';
}

export interface PlaceOptions {
  secretOf: SecretOf;
  /** The drivers this runner can run (the Node registry's), by id. */
  served: ReadonlySet<DriverId>;
  /** The environment, to say in `check` whether a secret came from a variable. */
  env?: Record<string, string | undefined>;
}

/** The file drivers: a connection naming a path or a file picked in the browser, which the runner finds by name beside the project. */
const isFileConnection = (connection: Connection) => {
  const d = driver(connection.driver);
  return d.fields.some((f) => f.kind === 'file') && !String(connection.settings.url ?? '').trim();
};

/** Where a file connection's database is on the runner: its path (absolute, or relative to the project), else the picked file's name beside the project or under sources/. */
export function connectionFileCandidates(connection: Connection, folder: string): string[] {
  const paths: string[] = [];
  const path = String(connection.settings.path ?? '').trim();
  if (path) paths.push(isAbsolute(path) ? path : join(folder, path));
  const name = basename(String(connection.settings.file ?? '').trim());
  if (name) paths.push(join(folder, name), join(folder, 'sources', name));
  return [...new Set(paths)];
}

/** Why a connection source can't be read by this runner, or the place it reads from. */
export function placeConnection(source: Source, project: Pick<Project, 'connections'>, folder: string, exists: (path: string) => boolean, options: PlaceOptions): { place: ConnectionPlace } | { reason: string } {
  const c = source.connection;
  const connection = c && project.connections.find((x) => x.id === c.connectionId);
  if (!connection) return { reason: 'reads a connection that was removed from the project' };
  const d = driver(connection.driver);
  const name = `“${connection.name}”`;
  if (!options.served.has(connection.driver)) return { reason: `reads a ${d.label} database through connection ${name}, which the runner can’t reach yet` };
  if (connection.auth === 'oauth') return { reason: `reads connection ${name}, which signs in with OAuth in the browser; the runner can’t` };
  let placed = connection;
  if (isFileConnection(connection)) {
    const candidates = connectionFileCandidates(connection, folder);
    if (!candidates.length) return { reason: `reads connection ${name}, which names no database file` };
    const found = candidates.find(exists);
    if (!found) return { reason: `reads connection ${name}, whose file was not found at ${candidates.join(' or ')}` };
    if (!insideFolders(found, [folder])) return { reason: `reads connection ${name}, whose file ${found} is outside the project’s folder ${resolve(folder)}` };
    placed = { ...connection, settings: { ...connection.settings, path: resolve(found) } };
    return { place: { connection: placed, secretFrom: 'none needed' } };
  }
  const label = SECRET_LABEL[connection.auth];
  if (!label) return { place: { connection: placed, secretFrom: 'none needed' } };
  const secret = options.secretOf(connection);
  if (secret === undefined) return { reason: `needs the ${label.toLowerCase()} of connection ${name}: set ${secretVariable(connection.name)}, or add "${connection.name}" to the PUDDLE_SECRETS file` };
  const fromVariable = options.env?.[secretVariable(connection.name)] !== undefined;
  return { place: { connection: placed, secret, secretFrom: fromVariable ? 'variable' : 'file' } };
}

/** What a placed connection source reads, for the log and `check`: the table or query, through which connection. */
export function describeConnectionSource(source: Source, place: ConnectionPlace): string {
  const c = source.connection!;
  const what = c.table ? `table ${c.table.schema ? `${c.table.schema}.` : ''}${c.table.name}` : 'a query';
  const d = driver(place.connection.driver);
  const secret = place.secretFrom === 'variable' ? `, secret from ${secretVariable(place.connection.name)}` : place.secretFrom === 'file' ? ', secret from PUDDLE_SECRETS' : '';
  return `${what} of connection “${place.connection.name}” (${d.label}${secret})`;
}
