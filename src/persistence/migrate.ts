import { FORMAT_VERSION, parseProject, type Project } from '../model';

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

/** Upgrades a project from format version n to n + 1. Add one here whenever FORMAT_VERSION goes up. */
export type Migration = (project: Record<string, unknown>) => Record<string, unknown>;

/**
 * Version 0 is a project written before the format was versioned: the same shape, without `formatVersion`.
 * Later migrations go here keyed by the version they upgrade from.
 */
export const MIGRATIONS: Record<number, Migration> = {
  0: (p) => ({ ...p, formatVersion: 1 }),
  // Format 2 adds each step as a node by default. Format 1 files always carried the old default (false), so the
  // setting is dropped and takes the new default; anyone who wants stacked steps turns it off in the project settings.
  1: (p) => {
    if (!isObject(p.settings)) return { ...p, formatVersion: 2 };
    const { stepsAsNodes: _, ...settings } = p.settings;
    return { ...p, settings, formatVersion: 2 };
  },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Run the migrations from a saved project's version up to `current`. Every older version upgrades; a project
 * from a newer Puddle is refused with a reason rather than half-read.
 */
export function upgrade(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS, current = FORMAT_VERSION): Record<string, unknown> {
  if (!isObject(raw)) throw new ProjectFileError('This isn’t a Puddle project file.');
  let p = raw;
  let version = p.formatVersion === undefined ? 0 : p.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) throw new ProjectFileError('This project file has an unreadable format version.');
  if (version > current) throw new ProjectFileError(`This project was saved by a newer version of Puddle (format ${version}). Update Puddle to open it.`);
  while (version < current) {
    const step = migrations[version];
    if (!step) throw new ProjectFileError(`Puddle can’t upgrade projects from format ${version}.`);
    p = step(p);
    version += 1;
  }
  return { ...p, formatVersion: current };
}

/** Bring a saved project up to the current format and validate it. */
export function migrate(raw: unknown): Project {
  const upgraded = upgrade(raw);
  try {
    return parseProject(upgraded);
  } catch {
    throw new ProjectFileError('This project file is damaged or incomplete, so it can’t be opened.');
  }
}

/** Read a `.puddle.json` file's text. */
export function readProjectFile(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('This file isn’t valid JSON, so it isn’t a Puddle project.');
  }
  return migrate(raw);
}

/** The text of a `.puddle.json` file. Sources keep their references and parse options; file contents never go in. */
export function writeProjectFile(project: Project): string {
  return JSON.stringify(project, null, 2) + '\n';
}

/** "Orders clean-up" to "orders-clean-up.puddle.json". */
export function projectFileName(project: Pick<Project, 'name'>): string {
  const slug = project.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-');
  return `${slug || 'project'}.puddle.json`;
}
