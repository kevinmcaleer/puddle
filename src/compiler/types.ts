// How DuckDB types relate when values from two tables meet: in a join key or in one appended column.

/** Families of DuckDB types that compare and combine without a cast. */
export function typeFamily(type: string): string {
  const t = type.toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL)$/.test(t) || t.startsWith('DECIMAL')) return 'number';
  if (t === 'VARCHAR' || t === 'TEXT' || t === 'STRING' || t.startsWith('VARCHAR(')) return 'text';
  if (t === 'DATE' || t.startsWith('TIMESTAMP')) return 'date';
  if (t === 'TIME' || t.startsWith('TIME ')) return 'time';
  if (t === 'BOOLEAN') return 'boolean';
  // A column with no values at all fits anything.
  if (t === 'NULL' || t === '"NULL"') return 'null';
  return t;
}

/** Whether two types can meet without a cast. */
export const typesFit = (a: string, b: string) => {
  const [fa, fb] = [typeFamily(a), typeFamily(b)];
  return fa === fb || fa === 'null' || fb === 'null';
};

const FAMILY_WORDS: Record<string, string> = { number: 'a number', text: 'text', date: 'a date', time: 'a time', boolean: 'true or false' };

/** A type in words: "a number", "text", "a date". */
export const describeType = (type: string) => FAMILY_WORDS[typeFamily(type)] ?? type;
