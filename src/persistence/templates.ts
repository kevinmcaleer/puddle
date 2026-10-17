// Templates upgrade through the project migrations: a template is read as a project with one Transform node holding
// its steps, so a migration that changes steps changes templates too, with nothing to add here.
import { FORMAT_VERSION } from '../model';
import { TemplateZ, type Template } from '../templates/template';
import { MIGRATIONS, ProjectFileError, upgrade, type Migration } from './migrate';

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The id of the one node a template is read as. */
export const TEMPLATE_NODE_ID = 'template';

/**
 * A template as a project with no sources and one Transform node: what the project migrations upgrade, and the shape
 * of a single-node recipe. The description travels as the project's notes, the expected columns alongside.
 */
export function templateAsProject(t: Record<string, unknown>): Record<string, unknown> {
  const { steps, description, expectedColumns, ...rest } = t;
  return {
    ...rest,
    notes: description ?? '',
    sources: [],
    nodes: [{ id: TEMPLATE_NODE_ID, type: 'transform', name: rest.name, position: { x: 0, y: 0 }, rules: [], steps }],
    edges: [],
    expectedColumns,
  };
}

/** Back from `templateAsProject`. */
export function templateFromProject(p: Record<string, unknown>): Record<string, unknown> {
  const { notes, sources: _s, nodes, edges: _e, view: _v, settings: _st, exportLog: _l, expectedColumns, ...rest } = p;
  const node = Array.isArray(nodes) ? nodes.find((n) => isObject(n) && n.id === TEMPLATE_NODE_ID) : undefined;
  return { ...rest, description: notes, steps: isObject(node) ? node.steps : undefined, expectedColumns };
}

/**
 * Bring a saved template up to the current format and validate it. A template from a newer Puddle is refused with a
 * reason; one that is damaged says so.
 */
export function migrateTemplate(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS, current = FORMAT_VERSION): Template {
  if (!isObject(raw) || !Array.isArray(raw.steps)) throw new TemplateError('This isn’t a Puddle template.');
  const version = raw.formatVersion ?? 0;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) throw new TemplateError('This template has an unreadable format version.');
  if (version > current) throw new TemplateError(`This template was saved by a newer version of Puddle (format ${version}). Update Puddle to use it.`);
  let upgraded: Record<string, unknown>;
  try {
    upgraded = upgrade(templateAsProject(raw), migrations, current);
  } catch (e) {
    if (e instanceof ProjectFileError) throw new TemplateError(`Puddle can’t upgrade templates from format ${version}.`);
    throw e;
  }
  const parsed = TemplateZ.safeParse(templateFromProject(upgraded));
  if (!parsed.success) throw new TemplateError('This template is damaged or incomplete, so it can’t be used.');
  return parsed.data;
}
