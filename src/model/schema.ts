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
  url: z.object({ href: z.string(), headers: z.record(z.string(), z.string()).optional() }).optional(),
  clipboard: z.object({ text: z.string() }).optional(),
  format: SourceFormatZ,
  parseOptions: ParseOptionsZ.default({}),
  detectedSchema: z.array(ColumnSchemaZ).default([]),
});

/** A step's params are validated by its step definition (compiler/steps); the model only fixes the envelope. */
export const StepZ = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string(),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().optional(),
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

export const NodeZ = z.discriminatedUnion('type', [SourceNodeZ, TransformNodeZ, OutputNodeZ]);

export const EdgeZ = z.object({
  id: z.string().min(1),
  from: z.object({ nodeId: z.string().min(1) }),
  /** port: input index on the target; "left" and "right" arrive with Join nodes in Phase 2. */
  to: z.object({ nodeId: z.string().min(1), port: z.union([z.number().int().nonnegative(), z.enum(['left', 'right'])]).default(0) }),
});

export const ProjectSettingsZ = z.object({
  sampleThresholdRows: z.number().int().positive().default(5_000_000),
  locale: z.string().default('en-GB'),
  defaultDateFormats: z.array(z.string()).default([]),
});

export const ProjectViewZ = z.object({
  viewedNodeId: z.string().optional(),
  viewedStepIndex: z.number().int().nonnegative().optional(),
  pinned: z.boolean().default(false),
  canvasViewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).default({ x: 0, y: 0, zoom: 1 }),
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
});

export type ColumnSchema = z.infer<typeof ColumnSchemaZ>;
export type SourceFormat = z.infer<typeof SourceFormatZ>;
export type ParseOptions = z.infer<typeof ParseOptionsZ>;
export type Source = z.infer<typeof SourceZ>;
export type Step = z.infer<typeof StepZ>;
export type Rule = z.infer<typeof RuleZ>;
export type SourceNode = z.infer<typeof SourceNodeZ>;
export type TransformNode = z.infer<typeof TransformNodeZ>;
export type OutputNode = z.infer<typeof OutputNodeZ>;
export type GraphNode = z.infer<typeof NodeZ>;
export type NodeType = GraphNode['type'];
export type Edge = z.infer<typeof EdgeZ>;
export type ProjectSettings = z.infer<typeof ProjectSettingsZ>;
export type ProjectView = z.infer<typeof ProjectViewZ>;
export type Project = z.infer<typeof ProjectZ>;
