// Recipes: a whole pipeline (sources, nodes, steps, rules and notes) with no data in it, so people can share how they
// cleaned something without sharing what they cleaned. A template travels the same way, as a single-node recipe.
import { ruleDef, stepDef } from '../compiler';
import { createProject, FORMAT_VERSION, newId, NodeZ, parseProject, type GraphNode, type Project, type Source, type Step } from '../model';
import { ProjectFileError, upgrade } from '../persistence/migrate';
import { withoutConnectionHost, withoutHeaderValues, withoutPastedRows } from '../persistence/shareable';
import { migrateTemplate, TEMPLATE_NODE_ID, templateAsProject, templateFromProject, TemplateError } from '../persistence/templates';
import type { Template } from '../templates/template';

/** Bump when the recipe envelope changes. The project inside follows FORMAT_VERSION and its migrations. */
export const RECIPE_VERSION = 1;

export const RECIPE_SUFFIX = '.puddle-recipe.json';

export class RecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeError';
  }
}

/** A recipe as written to a `.puddle-recipe.json` file. */
export interface RecipeFile {
  puddleRecipe: number;
  /** A whole pipeline, or one Transform node's steps (a template). */
  kind: 'pipeline' | 'template';
  formatVersion: number;
  name: string;
  description: string;
  notes: string;
  settings?: Project['settings'];
  /** Database connections by driver and database only: no host, user or secret (plan D25). */
  connections?: Project['connections'];
  sources: Source[];
  nodes: GraphNode[];
  edges: Project['edges'];
  /** Templates only: the input columns the steps read. */
  expectedColumns?: Template['expectedColumns'];
}

/** A recipe read and checked: a pipeline to open as a new project, or a template for the library. */
export type Recipe =
  | { kind: 'pipeline'; name: string; description: string; project: Pick<Project, 'notes' | 'settings' | 'connections' | 'sources' | 'nodes' | 'edges'> }
  | { kind: 'template'; name: string; description: string; template: Template };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A web address without what may be private in it: a user name and password, the query string (where keys and
 * tokens often go) and the fragment. An address that can't be read is left out altogether.
 */
export function shareableHref(href: string): string {
  try {
    const url = new URL(href);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * A source as a recipe describes it: a label, its format, read options and the columns it is expected to have.
 * Never the file (its name, size, dates and head hash) or a file set's files, pasted rows, a sample setting, request header values or the
 * private parts of an address. A pasted source asks for a file instead, since its rows don't travel.
 */
export function recipeSource(source: Source): Source {
  const { file: _f, sampleRows: _s, expected: _e, url, ...rest } = withoutHeaderValues(withoutPastedRows(source));
  const href = source.kind === 'url' && url ? shareableHref(url.href) : '';
  // A file set keeps which files it reads (its pattern), never their names: it asks for its files like any source.
  if (source.kind === 'files') return { ...rest, fileSet: { files: [], ...(source.fileSet?.pattern ? { pattern: source.fileSet.pattern } : {}), ...(source.fileSet?.fileColumn ? { fileColumn: true } : {}) } };
  if (href) return { ...rest, url: { href, ...(url?.headers ? { headers: url.headers } : {}), ...(url?.table ? { table: url.table } : {}), ...(url?.odata ? { odata: url.odata } : {}) } };
  // Pasted rows don't travel, and an address that can't be shared isn't one: either asks for a file.
  return { ...rest, kind: 'file' };
}

/**
 * A step as a recipe keeps it. Pivot and Transpose hold values read from the rows when they were set up (the values
 * that became columns, the header row); those are data, so they are left out and the step asks to be refreshed.
 */
export function recipeStep(step: Step): Step {
  const p = step.params;
  if (step.type === 'pivot' && typeof p.column === 'string' && p.column) return { ...step, params: { ...p, pivotValues: [], moreValues: false, names: {} } };
  if (step.type === 'transpose') return { ...step, params: { ...p, rowCount: 0, headerValues: [] } };
  return step;
}

/** A node as a recipe keeps it: no kept result, and no export file name. */
export function recipeNode(node: GraphNode): GraphNode {
  const { pinnedResult: _p, ...rest } = node;
  if (rest.type === 'transform') return { ...rest, steps: rest.steps.map(recipeStep) };
  if (rest.type === 'output') {
    const { fileName: _f, ...spec } = rest.outputSpec;
    return { ...rest, outputSpec: spec };
  }
  return rest;
}

/** "Tidy contacts" to "tidy-contacts.puddle-recipe.json". */
export function recipeFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-');
  return `${slug || 'recipe'}${RECIPE_SUFFIX}`;
}

/** The recipe of a project: its graph, steps, rules and notes, with every source reduced to what it expects. */
export function recipeFromProject(project: Project, about: { name: string; description: string }): RecipeFile {
  return {
    puddleRecipe: RECIPE_VERSION,
    kind: 'pipeline',
    formatVersion: project.formatVersion,
    name: about.name.trim() || project.name,
    description: about.description.trim(),
    notes: project.notes,
    settings: project.settings,
    connections: project.connections.map(withoutConnectionHost),
    sources: project.sources.map(recipeSource),
    nodes: project.nodes.map(recipeNode),
    edges: project.edges,
  };
}

/** A template as a single-node recipe: the shape templates are migrated in (persistence/templates.ts). */
export function recipeFromTemplate(template: Template): RecipeFile {
  const { id: _i, createdAt: _c, updatedAt: _u, ...shaped } = templateAsProject({ ...template, steps: template.steps.map(recipeStep) });
  return { puddleRecipe: RECIPE_VERSION, kind: 'template', description: template.description, ...shaped } as unknown as RecipeFile;
}

export const writeRecipe = (recipe: RecipeFile) => JSON.stringify(recipe, null, 2) + '\n';

const NODE_TYPES = new Set<string>(NodeZ.options.map((o) => o.shape.type.value));

const newer = (what: string) => `This recipe uses ${what} this version of Puddle doesn’t know, so it may be from a newer Puddle. Update Puddle to open it.`;

/** Refuse, with a reason, a recipe that names a node, step or rule type Puddle doesn't have. */
function checkTypes(raw: Record<string, unknown>) {
  const rules = (v: unknown) => (Array.isArray(v) ? v.filter(isObject) : []);
  const unknownRule = (list: unknown) => rules(list).find((r) => typeof r.type !== 'string' || !ruleDef(r.type));
  for (const node of Array.isArray(raw.nodes) ? raw.nodes.filter(isObject) : []) {
    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) throw new RecipeError(newer(`a kind of node (“${String(node.type)}”)`));
    const rule = unknownRule(node.rules);
    if (rule) throw new RecipeError(newer(`a rule (“${String(rule.type)}”)`));
    for (const step of Array.isArray(node.steps) ? node.steps.filter(isObject) : []) {
      if (typeof step.type !== 'string' || !stepDef(step.type)) throw new RecipeError(newer(`a step (“${String(step.type)}”)`));
      const originRule = isObject(step.origin) ? unknownRule(step.origin.rules) : undefined;
      if (originRule) throw new RecipeError(newer(`a rule (“${String(originRule.type)}”)`));
    }
  }
}

/** Check a parsed recipe file and bring it up to the current format. Anything that doesn't fit is refused with a reason. */
export function parseRecipe(raw: unknown, at: Date = new Date()): Recipe {
  if (!isObject(raw)) throw new RecipeError('This isn’t a Puddle recipe.');
  if (raw.puddleRecipe === undefined) {
    if (Array.isArray(raw.nodes) && typeof raw.id === 'string') throw new RecipeError('This is a Puddle project, not a recipe. Use Open project file to open it.');
    throw new RecipeError('This isn’t a Puddle recipe.');
  }
  const version = raw.puddleRecipe;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new RecipeError('This recipe has an unreadable version.');
  const format = raw.formatVersion ?? 0;
  if (version > RECIPE_VERSION || (typeof format === 'number' && format > FORMAT_VERSION))
    throw new RecipeError('This recipe was made by a newer version of Puddle. Update Puddle to open it.');
  checkTypes(raw);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled recipe';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const iso = at.toISOString();

  if (raw.kind === 'template') {
    const node = Array.isArray(raw.nodes) ? raw.nodes.find((n) => isObject(n) && n.id === TEMPLATE_NODE_ID) : undefined;
    if (!node) throw new RecipeError('This template recipe is damaged or incomplete, so it can’t be used.');
    try {
      const template = migrateTemplate(templateFromProject({ ...raw, id: newId('tpl'), name, createdAt: iso, updatedAt: iso }));
      return { kind: 'template', name, description: template.description, template: { ...template, steps: template.steps.map(recipeStep) } };
    } catch (e) {
      if (e instanceof TemplateError) throw new RecipeError(e.message.replace('template', 'recipe'));
      throw e;
    }
  }
  if (raw.kind !== 'pipeline') throw new RecipeError('This isn’t a Puddle recipe.');

  let project: Project;
  try {
    project = parseProject(upgrade({ ...raw, id: 'recipe', name, createdAt: iso, updatedAt: iso }));
  } catch (e) {
    if (e instanceof ProjectFileError) throw new RecipeError(e.message.replace(/project/g, 'recipe'));
    throw new RecipeError('This recipe is damaged or incomplete, so it can’t be opened.');
  }
  // Whatever the file carried, only what a recipe describes is kept.
  const { notes, settings, edges } = project;
  return { kind: 'pipeline', name, description, project: { notes, settings, edges, connections: project.connections.map(withoutConnectionHost), sources: project.sources.map(recipeSource), nodes: project.nodes.map(recipeNode) } };
}

/** Read a `.puddle-recipe.json` file's text. */
export function readRecipe(text: string, at?: Date): Recipe {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RecipeError('This file isn’t valid JSON, so it isn’t a Puddle recipe.');
  }
  return parseRecipe(raw, at);
}

/** The columns each source of a pipeline recipe expects, by source label, for the gallery and the attach prompts. */
export const expectedBySource = (recipe: Extract<Recipe, { kind: 'pipeline' }>) => recipe.project.sources.map((s) => ({ id: s.id, name: s.name, format: s.format, columns: s.detectedSchema }));

/**
 * A new project from a pipeline recipe. Its sources start with no file: each asks to be attached, and remembers the
 * columns the recipe expects so a file whose columns differ is offered the column mapping. The description becomes
 * the project's notes when it has none.
 */
export function projectFromRecipe(recipe: Extract<Recipe, { kind: 'pipeline' }>, at: Date = new Date()): Project {
  const base = createProject(recipe.name, at);
  const { notes, settings, connections, sources, nodes, edges } = recipe.project;
  // New source ids: files are kept per tab by source id, so a second project from the same recipe mustn't pick up
  // the file chosen for the first.
  const ids = new Map(sources.map((s) => [s.id, newId('s')]));
  return parseProject({
    ...base,
    notes: notes || recipe.description,
    settings,
    connections,
    sources: sources.map((s) => ({ ...s, id: ids.get(s.id)!, ...(s.detectedSchema.length ? { expected: s.detectedSchema } : {}) })),
    nodes: nodes.map((n) => (n.type === 'source' ? { ...n, sourceId: ids.get(n.sourceId) ?? n.sourceId } : n)),
    edges,
  });
}
