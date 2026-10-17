import { z } from 'zod';

/** Bump when the saved shape changes, and add a migration in persistence. */
export const FORMAT_VERSION = 1;

export const ColumnSchemaZ = z.object({ name: z.string(), type: z.string() });

export const SourceFormatZ = z.enum(['csv', 'tsv', 'json', 'ndjson', 'parquet', 'xlsx']);

export const ParseOptionsZ = z
  .object({
    delimiter: z.string(),
    header: z.boolean(),
    encoding: z.string(),
    quote: z.string(),
    nullStrings: z.array(z.string()),
    sheet: z.string(),
    headerRow: z.number().int().nonnegative(),
    /** Excel: an A1 cell range to read, such as B3:F200. */
    range: z.string(),
  })
  .partial();

export const SourceZ = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(['file', 'url', 'clipboard']),
  file: z
    .object({
      originalName: z.string(),
      size: z.number().nonnegative(),
      lastModified: z.number(),
      /** Hash of the first 1 MB, used to warn when a re-selected file looks different. */
      headHash: z.string(),
      fsHandleRef: z.string().optional(),
      /** Where the runner (puddle-run) finds this file: absolute, or relative to the project file's folder. */
      path: z.string().optional(),
    })
    .optional(),
  url: z
    .object({
      href: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      /** Hash of the first 1 MB when last fetched, to notice when the file at the address has changed. */
      headHash: z.string().optional(),
      size: z.number().nonnegative().optional(),
      /**
       * A sample dataset shipped with Puddle (src/samples), by file name: read from wherever Puddle is served (and so
       * offline, from the service worker's cache) rather than from `href`, which only records where it was first read.
       */
      sample: z.string().optional(),
    })
    .optional(),
  clipboard: z.object({ text: z.string() }).optional(),
  format: SourceFormatZ,
  parseOptions: ParseOptionsZ.default({}),
  detectedSchema: z.array(ColumnSchemaZ).default([]),
  /**
   * The columns a recipe expects this source to have (src/recipes), kept until its first file is read: a file whose
   * columns differ is offered the column mapping, and then this goes.
   */
  expected: z.array(ColumnSchemaZ).optional(),
  /**
   * Sample mode: read only the first this-many rows. Set only on the in-memory copy that previews, profiles and
   * rules compile from (flow/sample.ts); the project itself never has it, so exports always read everything.
   */
  sampleRows: z.number().int().positive().optional(),
});

/**
 * Where a step came from when nodes were grouped: the first step of each absorbed node carries that node, so
 * ungrouping restores the exact original graph.
 */
export const StepOriginZ = z.object({
  nodeId: z.string().min(1),
  name: z.string(),
  notes: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  collapsed: z.boolean().optional(),
  rules: z.array(z.lazy(() => RuleZ)).default([]),
  /** The wire that ran into the absorbed node from the node before it. */
  edgeId: z.string().min(1),
});

/** A step's params are validated by its step definition (compiler/steps); the model only fixes the envelope. */
export const StepZ = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string(),
  /** True once someone renamed the step; its label then stops following its settings. */
  customLabel: z.boolean().optional(),
  enabled: z.boolean().default(true),
  /** Why the step arrived turned off, e.g. a template step whose column the input lacks. Cleared when it's turned on. */
  disabledReason: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().optional(),
  origin: StepOriginZ.optional(),
});

export const RuleZ = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string(),
  enabled: z.boolean().default(true),
  severity: z.enum(['warn', 'fail']).default('fail'),
  params: z.record(z.string(), z.unknown()).default({}),
});

const PositionZ = z.object({ x: z.number(), y: z.number() });

const NodeBase = {
  id: z.string().min(1),
  name: z.string(),
  notes: z.string().optional(),
  position: PositionZ.default({ x: 0, y: 0 }),
  collapsed: z.boolean().optional(),
  rules: z.array(RuleZ).default([]),
  /** Suggested rules dismissed for this node, by suggestion key (rule type and column), so they stay dismissed. */
  dismissedSuggestions: z.array(z.string()).optional(),
  /** Materialise as a table for reuse (Phase 2). */
  pinnedResult: z.boolean().optional(),
};

export const SourceNodeZ = z.object({ ...NodeBase, type: z.literal('source'), sourceId: z.string().min(1) });

/** A Check node is a transform with no steps. */
export const TransformNodeZ = z.object({ ...NodeBase, type: z.literal('transform'), steps: z.array(StepZ).default([]) });

export const OutputSpecZ = z.object({
  format: z.enum(['csv', 'parquet', 'json', 'ndjson', 'clipboard', 'xlsx']).default('csv'),
  fileName: z.string().optional(),
  options: z.record(z.string(), z.unknown()).default({}),
});

export const OutputNodeZ = z.object({ ...NodeBase, type: z.literal('output'), outputSpec: OutputSpecZ.default({ format: 'csv', options: {} }) });

/** How a Join node matches rows: anti keeps left rows with no match, semi keeps left rows with one. */
export const JOIN_KINDS = ['inner', 'left', 'right', 'full', 'anti', 'semi'] as const;

export const JoinKeyZ = z.object({ left: z.string(), right: z.string() });

export const JoinSpecZ = z.object({
  kind: z.enum(JOIN_KINDS).default('left'),
  /** Pairs of columns that must be equal, all of them, for a left row to match a right row. */
  keys: z.array(JoinKeyZ).default([]),
  /** Added to a right column whose name the left side already uses. */
  suffix: z.string().default('_right'),
});

export const DEFAULT_JOIN_SPEC = { kind: 'left', keys: [], suffix: '_right' } as const satisfies z.input<typeof JoinSpecZ>;

export const JoinNodeZ = z.object({ ...NodeBase, type: z.literal('join'), joinSpec: JoinSpecZ.default({ ...DEFAULT_JOIN_SPEC, keys: [] }) });

export const AppendSpecZ = z.object({
  /** Line columns up by name (missing ones come out empty) or by position (names from the first input). */
  match: z.enum(['name', 'position']).default('name'),
  /** Add a column naming the input each row came from. */
  tagRows: z.boolean().default(false),
  tagColumn: z.string().default('source'),
});

export const DEFAULT_APPEND_SPEC = { match: 'name', tagRows: false, tagColumn: 'source' } as const satisfies z.input<typeof AppendSpecZ>;

/** Stacks its inputs' rows, in input order. Inputs are numbered ports; a free one is always offered after the last. */
export const AppendNodeZ = z.object({ ...NodeBase, type: z.literal('append'), appendSpec: AppendSpecZ.default({ ...DEFAULT_APPEND_SPEC }) });

/** One pair of columns that must be equal: a column of the main input and one of the lookup input. */
export const LookupKeyZ = z.object({ main: z.string(), lookup: z.string() });

export const LookupSpecZ = z.object({
  /** A main row matches a lookup row when every pair is equal. */
  keys: z.array(LookupKeyZ).default([]),
  /** The lookup input's columns brought across, in order. */
  columns: z.array(z.string()).default([]),
  /** Added to a brought column whose name the main input already uses. */
  suffix: z.string().default('_lookup'),
  /** Fill the brought columns of a main row whose key has no match with `defaultValue`, instead of leaving them empty. */
  useDefault: z.boolean().default(false),
  defaultValue: z.string().default(''),
});

export const DEFAULT_LOOKUP_SPEC = { keys: [], columns: [], suffix: '_lookup', useDefault: false, defaultValue: '' } as const satisfies z.input<typeof LookupSpecZ>;

/** Brings columns across from its lookup input by key, one match per main row, so the main input's row count never changes. */
export const LookupNodeZ = z.object({ ...NodeBase, type: z.literal('lookup'), lookupSpec: LookupSpecZ.default({ ...DEFAULT_LOOKUP_SPEC, keys: [], columns: [] }) });

/** How a Query join line matches rows: inner keeps matches only; left and right keep every row of that end's table. */
export const QUERY_JOIN_KINDS = ['inner', 'left', 'right', 'full'] as const;

/** One end of a join line in the query designer: a column of the table in that input. */
export const QueryFieldRefZ = z.object({ port: z.number().int().nonnegative(), column: z.string() });

/** A join line, drawn by dragging `left`'s column onto `right`'s (a primary key onto a foreign key, say). */
export const QueryJoinZ = z.object({
  id: z.string().min(1),
  left: QueryFieldRefZ,
  right: QueryFieldRefZ,
  /** left: every row of the left table; right: every row of the right table. */
  kind: z.enum(QUERY_JOIN_KINDS).default('inner'),
});

export const QUERY_CRITERIA_OPS = ['=', '<>', '<', '<=', '>', '>=', 'contains', 'starts', 'ends', 'empty', 'notEmpty'] as const;

export const QueryCriteriaZ = z.object({ op: z.enum(QUERY_CRITERIA_OPS), value: z.string().default('') });

/**
 * A field's Total, when the grid has its Totals row: group by it, summarise it, an expression of summaries, or Where
 * (filter rows on it before grouping, without showing it).
 */
export const QUERY_TOTALS = ['group', 'sum', 'avg', 'min', 'max', 'count', 'countDistinct', 'first', 'last', 'stdev', 'var', 'expression', 'where'] as const;

/** One column of the query grid: a field of one table ("*" for all of them), and what to do with it. */
export const QueryFieldZ = z.object({
  id: z.string().min(1),
  port: z.number().int().nonnegative(),
  /** A column of the table in that input, or "*" for every column. */
  column: z.string(),
  /** The name it has in the result; the column's own name when empty. */
  alias: z.string().optional(),
  show: z.boolean().default(true),
  sort: z.enum(['none', 'asc', 'desc']).default('none'),
  criteria: QueryCriteriaZ.optional(),
  /** Its cells in the "or" rows below Criteria, by row; null (or missing) where a row has no condition on it. */
  or: z.array(QueryCriteriaZ.nullable()).optional(),
  /** Its Total while the Totals row is on; Group by when unset. Kept while Totals is off, so turning it back on restores it. */
  total: z.enum(QUERY_TOTALS).optional(),
  /** A DuckDB expression over the tables' columns, using summaries such as sum(total), for the Expression total. */
  expression: z.string().optional(),
});

export const QuerySpecZ = z.object({
  /** Where each input's table sits in the designer, by input. */
  tables: z.array(z.object({ port: z.number().int().nonnegative(), x: z.number(), y: z.number() })).default([]),
  joins: z.array(QueryJoinZ).default([]),
  fields: z.array(QueryFieldZ).default([]),
  /** Leave out rows that repeat another row exactly. */
  distinct: z.boolean().default(false),
  /** The Totals row: group the rows by some fields and summarise the others. */
  totals: z.boolean().default(false),
  /** How many "or" rows the grid has below Criteria: each row's conditions are ANDed, and the rows ORed. */
  orRows: z.number().int().nonnegative().default(0),
});

export const DEFAULT_QUERY_SPEC = { tables: [], joins: [], fields: [], distinct: false, totals: false, orRows: 0 } as const satisfies z.input<typeof QuerySpecZ>;

/**
 * A query built in the designer, as in Microsoft Access: each numbered input is a table, join lines run between their
 * columns, and the grid picks the fields, their order, sorting and criteria.
 */
export const QueryNodeZ = z.object({ ...NodeBase, type: z.literal('query'), querySpec: QuerySpecZ.default({ tables: [], joins: [], fields: [], distinct: false, totals: false, orRows: 0 }) });

/** A hand-written DuckDB query over the node's inputs, each readable as input1, input2... and by its node's name. */
export const SqlSpecZ = z.object({ query: z.string().default('') });

export const DEFAULT_SQL_SPEC = { query: 'SELECT *\nFROM input1' } as const satisfies z.input<typeof SqlSpecZ>;

export const SqlNodeZ = z.object({ ...NodeBase, type: z.literal('sql'), sqlSpec: SqlSpecZ.default(DEFAULT_SQL_SPEC) });

export const NodeZ = z.discriminatedUnion('type', [SourceNodeZ, TransformNodeZ, JoinNodeZ, AppendNodeZ, LookupNodeZ, QueryNodeZ, SqlNodeZ, OutputNodeZ]);

/** Named input ports: Join's left and right, Lookup's main and lookup. Nodes with one input, and the numbered inputs of Append and Query, use an index. */
export const NAMED_PORTS = ['left', 'right', 'main', 'lookup'] as const;

export const PortZ = z.union([z.number().int().nonnegative(), z.enum(NAMED_PORTS)]);

export const EdgeZ = z.object({
  id: z.string().min(1),
  from: z.object({ nodeId: z.string().min(1) }),
  /** port: which input of the target the wire goes into (see inputPorts in graph.ts). */
  to: z.object({ nodeId: z.string().min(1), port: PortZ.default(0) }),
});

export const ProjectSettingsZ = z.object({
  sampleThresholdRows: z.number().int().positive().default(5_000_000),
  locale: z.string().default('en-GB'),
  defaultDateFormats: z.array(z.string()).default([]),
  /** When the runner (puddle-run) runs this project's outputs, in cron syntax. Nothing runs until one is set. */
  schedule: z.string().optional(),
});

export const ProjectViewZ = z.object({
  viewedNodeId: z.string().optional(),
  viewedStepIndex: z.number().int().nonnegative().optional(),
  /** The results table shows only the viewed node's rows that fail this rule. */
  failingRuleId: z.string().optional(),
  /** The results table stays on the viewed node while other nodes are clicked. */
  pinned: z.boolean().default(false),
  /** With the table pinned, a second node shown next to it. */
  compare: z.object({ nodeId: z.string().min(1) }).optional(),
  canvasViewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).default({ x: 0, y: 0, zoom: 1 }),
});

/** One export from an Output node, kept with the project; an override names the failing rules it went past. */
export const ExportLogEntryZ = z.object({
  id: z.string().min(1),
  at: z.string(),
  nodeId: z.string().min(1),
  nodeName: z.string(),
  format: OutputSpecZ.shape.format,
  fileName: z.string(),
  rows: z.number().int().nonnegative(),
  /** The failing rules exported past; the ids (absent on older entries) let a quality report match them to the rule. */
  overridden: z.array(z.object({ nodeName: z.string(), rule: z.string(), nodeId: z.string().optional(), ruleId: z.string().optional() })).optional(),
  /** Stop was pressed: nothing was saved. */
  cancelled: z.boolean().optional(),
});

export const ProjectZ = z.object({
  id: z.string().min(1),
  name: z.string(),
  formatVersion: z.literal(FORMAT_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),
  notes: z.string().default(''),
  settings: ProjectSettingsZ.default({ sampleThresholdRows: 5_000_000, locale: 'en-GB', defaultDateFormats: [] }),
  sources: z.array(SourceZ).default([]),
  nodes: z.array(NodeZ).default([]),
  edges: z.array(EdgeZ).default([]),
  view: ProjectViewZ.default({ pinned: false, canvasViewport: { x: 0, y: 0, zoom: 1 } }),
  /** Newest first, at most EXPORT_LOG_LIMIT entries. Not part of undo: an export happened either way. */
  exportLog: z.array(ExportLogEntryZ).default([]),
});

export const EXPORT_LOG_LIMIT = 50;

export type ColumnSchema = z.infer<typeof ColumnSchemaZ>;
export type SourceFormat = z.infer<typeof SourceFormatZ>;
export type ParseOptions = z.infer<typeof ParseOptionsZ>;
export type Source = z.infer<typeof SourceZ>;
export type Step = z.infer<typeof StepZ>;
export type StepOrigin = z.infer<typeof StepOriginZ>;
export type Rule = z.infer<typeof RuleZ>;
export type SourceNode = z.infer<typeof SourceNodeZ>;
export type TransformNode = z.infer<typeof TransformNodeZ>;
export type OutputNode = z.infer<typeof OutputNodeZ>;
export type JoinKind = (typeof JOIN_KINDS)[number];
export type JoinKey = z.infer<typeof JoinKeyZ>;
export type JoinSpec = z.infer<typeof JoinSpecZ>;
export type JoinNode = z.infer<typeof JoinNodeZ>;
export type AppendSpec = z.infer<typeof AppendSpecZ>;
export type AppendNode = z.infer<typeof AppendNodeZ>;
export type LookupKey = z.infer<typeof LookupKeyZ>;
export type LookupSpec = z.infer<typeof LookupSpecZ>;
export type LookupNode = z.infer<typeof LookupNodeZ>;
export type QueryJoinKind = (typeof QUERY_JOIN_KINDS)[number];
export type QueryFieldRef = z.infer<typeof QueryFieldRefZ>;
export type QueryJoin = z.infer<typeof QueryJoinZ>;
export type QueryCriteriaOp = (typeof QUERY_CRITERIA_OPS)[number];
export type QueryTotal = (typeof QUERY_TOTALS)[number];
export type QueryCriteria = z.infer<typeof QueryCriteriaZ>;
export type QueryField = z.infer<typeof QueryFieldZ>;
export type QuerySpec = z.infer<typeof QuerySpecZ>;
export type QueryNode = z.infer<typeof QueryNodeZ>;
export type SqlSpec = z.infer<typeof SqlSpecZ>;
export type SqlNode = z.infer<typeof SqlNodeZ>;
export type Port = z.infer<typeof PortZ>;
export type GraphNode = z.infer<typeof NodeZ>;
export type NodeType = GraphNode['type'];
export type Edge = z.infer<typeof EdgeZ>;
export type ProjectSettings = z.infer<typeof ProjectSettingsZ>;
export type ProjectView = z.infer<typeof ProjectViewZ>;
export type Project = z.infer<typeof ProjectZ>;
export type ExportLogEntry = z.infer<typeof ExportLogEntryZ>;
