export type ColumnKind = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'json';

/** Map a DuckDB type name to the tag shown in headers. Types are never coloured. */
export function columnKind(duckType: string): ColumnKind {
  const t = duckType.toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT)$/.test(t)) return 'integer';
  if (/^(FLOAT|DOUBLE|REAL|DECIMAL)/.test(t)) return 'decimal';
  if (t === 'BOOLEAN') return 'boolean';
  if (t === 'DATE') return 'date';
  if (t.startsWith('TIMESTAMP') || t === 'TIME') return 'timestamp';
  if (t.startsWith('STRUCT') || t.startsWith('MAP') || t.endsWith('[]') || t === 'JSON') return 'json';
  return 'text';
}
