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
    })
    .optional(),
  url: z
    .object({
      href: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      /** Hash of the first 1 MB when last fetched, to notice when the file at the address has changed. */
      headHash: z.string().optional(),
      size: z.number().nonnegative().optional(),
    })
    .optional(),
  clipboard: z.object({ text: z.string() }).optional(),
  format: SourceFormatZ,
  parseOptions: ParseOptionsZ.default({}),
  detectedSchema: z.array(ColumnSchemaZ).default([]),
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
  /** Materialise as a table for reuse (Phase 2). */
  pinnedResult: z.boolean().optional(),
};

export const SourceNodeZ = z.object({ ...NodeBase, type: z.literal('source'), sourceId: z.string().min(1) });

/** A Check node is a transform with no steps. */
export const TransformNodeZ = z.object({ ...NodeBase, type: z.literal('transform'), steps: z.array(StepZ).default([]) });

export const OutputSpecZ = z.object({
  format: z.enum(['csv', 'parquet', 'json', 'ndjson', 'clipboard']).default('csv'),
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

export const NodeZ = z.discriminatedUnion('type', [SourceNodeZ, TransformNodeZ, JoinNodeZ, OutputNodeZ]);

/** Named input ports. Join uses left and right; nodes with one input, or numbered inputs, use an index. */
export const NAMED_PORTS = ['left', 'right'] as const;

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
});

export const ProjectViewZ = z.object({
  viewedNodeId: z.string().optional(),
  viewedStepIndex: z.number().int().nonnegative().optional(),
  /** The results table shows only the viewed node's rows that fail this rule. */
  failingRuleId: z.string().optional(),
  pinned: z.boolean().default(false),
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
  overridden: z.array(z.object({ nodeName: z.string(), rule: z.string() })).optional(),
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
export type Port = z.infer<typeof PortZ>;
export type GraphNode = z.infer<typeof NodeZ>;
export type NodeType = GraphNode['type'];
export type Edge = z.infer<typeof EdgeZ>;
export type ProjectSettings = z.infer<typeof ProjectSettingsZ>;
export type ProjectView = z.infer<typeof ProjectViewZ>;
export type Project = z.infer<typeof ProjectZ>;
export type ExportLogEntry = z.infer<typeof ExportLogEntryZ>;
