// The connection form's model, pure: a new connection for a driver, and the route it starts on given what answers.
import { newId, nextConnectionName, type Connection, type ConnectionVia, type DriverId, type Project } from '../model';
import { defaultSettings, driver } from './drivers';

/** Where a new connection runs: the browser where the driver allows it, else the first service route that answers, else the first it allows. */
export function defaultVia(id: DriverId, reach: { local?: unknown; pi?: unknown }): ConnectionVia {
  const d = driver(id);
  if (d.runsIn.includes('browser')) return 'browser';
  const answering = d.runsIn.find((v) => (v === 'local' && reach.local) || (v === 'pi' && reach.pi));
  return answering ?? d.runsIn[0]!;
}

export function newConnection(project: Project, id: DriverId, reach: { local?: unknown; pi?: unknown }): Connection {
  const d = driver(id);
  return { id: newId('c'), name: nextConnectionName(project, d.label), driver: id, via: defaultVia(id, reach), settings: defaultSettings(d), auth: d.auth };
}

/** A connection copied from another project: a fresh id, a free name, and no catalogue (it is read again). */
export function copyConnection(project: Project, from: Connection): Connection {
  const { catalog: _c, catalogAt: _a, documentedAt: _d, ...rest } = from;
  return { ...rest, id: newId('c'), name: nextConnectionName(project, from.name) };
}
