// The schema a project's DBML describes (dbml.dbdiagram.io): tables, refs, enums, groups, sticky notes, partials,
// records and diagram views. parseDbml builds it from text and writeDbml writes it back; everything else in Phase 4
// (the Schema view, schema tables, DDL, rules) reads this model, never the text.
import { z } from 'zod';

/** Where an element sits in the DBML text, as offsets, so two-way editing can change it in place. */
export const RangeZ = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });

/** A column default as written: a number, a quoted string, a backtick expression, true or false, or null. */
export const DefaultZ = z.object({ kind: z.enum(['number', 'string', 'boolean', 'null', 'expression']), value: z.string() });

/** Free-form custom properties (`[owner: "data-team"]`): string or colour values, by key. */
const PropertiesZ = z.record(z.string(), z.string());

export const ColumnZ = z.object({
  name: z.string(),
  /** As written, without the quotes a multi-word type needs: `varchar(255)`, `double precision`, `v2.job_status`. */
  type: z.string(),
  pk: z.boolean(),
  unique: z.boolean(),
  /** true for `not null`, false for an explicit `null`, absent when neither is written (nullable). */
  notNull: z.boolean().optional(),
  increment: z.boolean(),
  default: DefaultZ.optional(),
  /** Backtick check expressions on the column, without the backticks. */
  checks: z.array(z.string()),
  note: z.string().optional(),
  properties: PropertiesZ,
  /** The TablePartial this column came from, when it isn't the table's own. */
  partial: z.string().optional(),
  range: RangeZ.optional(),
  nameRange: RangeZ.optional(),
});

export const IndexPartZ = z.object({ kind: z.enum(['column', 'expression']), value: z.string() });

export const IndexZ = z.object({
  parts: z.array(IndexPartZ).min(1),
  type: z.string().optional(),
  name: z.string().optional(),
  unique: z.boolean(),
  pk: z.boolean(),
  note: z.string().optional(),
  partial: z.string().optional(),
  range: RangeZ.optional(),
});

export const CheckZ = z.object({ expression: z.string(), name: z.string().optional(), partial: z.string().optional(), range: RangeZ.optional() });

/** Where a `~partial` is injected: after `at` of the table's own columns. */
export const InjectionZ = z.object({ name: z.string(), at: z.number().int().nonnegative() });

export const TableZ = z.object({
  schema: z.string(),
  name: z.string(),
  alias: z.string().optional(),
  headerColor: z.string().optional(),
  note: z.string().optional(),
  properties: PropertiesZ,
  /** Every column, own and injected, in the order DBML resolves them (see resolvePartials). */
  columns: z.array(ColumnZ),
  indexes: z.array(IndexZ),
  checks: z.array(CheckZ),
  partials: z.array(InjectionZ),
  range: RangeZ.optional(),
  nameRange: RangeZ.optional(),
});

export const TablePartialZ = z.object({
  name: z.string(),
  headerColor: z.string().optional(),
  note: z.string().optional(),
  properties: PropertiesZ,
  columns: z.array(ColumnZ),
  indexes: z.array(IndexZ),
  checks: z.array(CheckZ),
  range: RangeZ.optional(),
});

/** One side of a ref: a table and one column, or several for a composite ref. */
export const EndpointZ = z.object({ schema: z.string(), table: z.string(), columns: z.array(z.string()).min(1) });

export const REF_OPS = ['<', '>', '-', '<>'] as const;
export const REF_ACTIONS = ['cascade', 'restrict', 'set null', 'set default', 'no action'] as const;

export const RefZ = z.object({
  name: z.string().optional(),
  from: EndpointZ,
  to: EndpointZ,
  /** `<` one-to-many, `>` many-to-one, `-` one-to-one, `<>` many-to-many, read from `from` to `to`. */
  op: z.enum(REF_OPS),
  /** `?` on that side: its rows don't have to match. */
  fromOptional: z.boolean(),
  toOptional: z.boolean(),
  delete: z.enum(REF_ACTIONS).optional(),
  update: z.enum(REF_ACTIONS).optional(),
  color: z.string().optional(),
  inactive: z.boolean(),
  /** Written in a column's settings (`[ref: > users.id]`); `from` is that column. */
  inline: z.boolean(),
  range: RangeZ.optional(),
});

export const EnumValueZ = z.object({ name: z.string(), note: z.string().optional() });
export const EnumZ = z.object({ schema: z.string(), name: z.string(), values: z.array(EnumValueZ), range: RangeZ.optional() });

export const TableNameZ = z.object({ schema: z.string(), name: z.string() });

export const TableGroupZ = z.object({
  name: z.string(),
  tables: z.array(TableNameZ),
  color: z.string().optional(),
  note: z.string().optional(),
  properties: PropertiesZ,
  range: RangeZ.optional(),
});

export const StickyNoteZ = z.object({
  name: z.string(),
  text: z.string(),
  /** A colour, or `none` for floating text with no background. */
  color: z.string().optional(),
  properties: PropertiesZ,
  range: RangeZ.optional(),
});

/** A value in a records row, as written; `empty` is a blank field (`1, , 3`), read as null. */
export const RecordValueZ = z.object({ kind: z.enum(['string', 'number', 'boolean', 'null', 'expression', 'enum', 'empty']), value: z.string() });

export const RecordsZ = z.object({
  schema: z.string(),
  table: z.string(),
  columns: z.array(z.string()),
  /** Written inside the table without a column list: `columns` are the table's, in order. */
  implicit: z.boolean(),
  /** Written inside the table rather than as a top-level `records table(...)` block. */
  inline: z.boolean(),
  /** `[example]`: illustration only, left out of INSERT exports. */
  example: z.boolean(),
  rows: z.array(z.array(RecordValueZ)),
  range: RangeZ.optional(),
});

/** A category of a DiagramView: everything (`{ * }`) or the names listed. */
const ViewListZ = z.union([z.literal('*'), z.array(z.string())]);

export const DiagramViewZ = z.object({
  name: z.string(),
  tables: ViewListZ.optional(),
  notes: ViewListZ.optional(),
  groups: ViewListZ.optional(),
  schemas: ViewListZ.optional(),
  range: RangeZ.optional(),
});

export const DbmlProjectZ = z.object({
  name: z.string().optional(),
  databaseType: z.string().optional(),
  note: z.string().optional(),
  properties: PropertiesZ,
});

export const DbmlSchemaZ = z.object({
  project: DbmlProjectZ.optional(),
  tables: z.array(TableZ),
  refs: z.array(RefZ),
  enums: z.array(EnumZ),
  groups: z.array(TableGroupZ),
  notes: z.array(StickyNoteZ),
  partials: z.array(TablePartialZ),
  records: z.array(RecordsZ),
  views: z.array(DiagramViewZ),
});

export type Range = z.infer<typeof RangeZ>;
export type Default = z.infer<typeof DefaultZ>;
export type Column = z.infer<typeof ColumnZ>;
export type IndexPart = z.infer<typeof IndexPartZ>;
export type Index = z.infer<typeof IndexZ>;
export type Check = z.infer<typeof CheckZ>;
export type Injection = z.infer<typeof InjectionZ>;
export type Table = z.infer<typeof TableZ>;
export type TablePartial = z.infer<typeof TablePartialZ>;
export type Endpoint = z.infer<typeof EndpointZ>;
export type RefOp = (typeof REF_OPS)[number];
export type RefAction = (typeof REF_ACTIONS)[number];
export type Ref = z.infer<typeof RefZ>;
export type EnumValue = z.infer<typeof EnumValueZ>;
export type DbmlEnum = z.infer<typeof EnumZ>;
export type TableName = z.infer<typeof TableNameZ>;
export type TableGroup = z.infer<typeof TableGroupZ>;
export type StickyNote = z.infer<typeof StickyNoteZ>;
export type RecordValue = z.infer<typeof RecordValueZ>;
export type Records = z.infer<typeof RecordsZ>;
export type DiagramView = z.infer<typeof DiagramViewZ>;
export type DbmlProject = z.infer<typeof DbmlProjectZ>;
export type DbmlSchema = z.infer<typeof DbmlSchemaZ>;

export const DEFAULT_SCHEMA = 'public';

export const emptySchema = (): DbmlSchema => ({ tables: [], refs: [], enums: [], groups: [], notes: [], partials: [], records: [], views: [] });

/** `schema.name`, or `name` in the public schema: how tables and enums are named in messages and lookups. */
export const qualified = (schema: string, name: string) => (schema === DEFAULT_SCHEMA ? name : `${schema}.${name}`);

/** The key a table or enum is found by: case-sensitive, as DBML names are. */
export const tableKey = (schema: string, name: string) => `${schema}\u0000${name}`;

export function findTable(schema: DbmlSchema, ref: { schema: string; table?: string; name?: string }): Table | undefined {
  const name = ref.table ?? ref.name;
  return schema.tables.find((t) => t.schema === ref.schema && t.name === name);
}

/** The enum a column's type names, if any: `job_status` in the public schema or `v2.job_status`. */
export function enumOf(schema: DbmlSchema, column: Pick<Column, 'type'>): DbmlEnum | undefined {
  const dot = column.type.indexOf('.');
  const [s, n] = dot > 0 ? [column.type.slice(0, dot), column.type.slice(dot + 1)] : [DEFAULT_SCHEMA, column.type];
  return schema.enums.find((e) => e.schema === s && e.name === n);
}

/** The model without source ranges: what two parses of equivalent text agree on. */
export function withoutRanges<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === 'range' || key === 'nameRange' ? undefined : v)));
}
