// The SQL dialects the DDL importer reads, and a guess at which one a script is written in from its syntax. The guess
// only picks quoting and defaults (the reader is tolerant either way), so a wrong guess still reads most scripts.

export const SQL_DIALECT_VALUES = ['postgres', 'mysql', 'sqlserver', 'sqlite', 'duckdb'] as const;

/** A SQL dialect the importer reads. MySQL covers MariaDB. */
export type SqlDialect = (typeof SQL_DIALECT_VALUES)[number];

/** Every dialect with the name shown for it. */
export const SQL_DIALECTS: readonly { value: SqlDialect; label: string }[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL and MariaDB' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'duckdb', label: 'DuckDB' },
];

/** The schemas a dialect puts unqualified tables in; these become DBML's default `public` schema. */
export const DEFAULT_SCHEMAS: Record<SqlDialect, readonly string[]> = {
  postgres: ['public'],
  mysql: [],
  sqlserver: ['dbo'],
  sqlite: ['main'],
  duckdb: ['main', 'public'],
};

/** Signs of each dialect with a weight; the dialect with the highest total wins. */
const SIGNS: Record<SqlDialect, [RegExp, number][]> = {
  postgres: [
    [/\b(?:big|small)?serial[248]?\b/i, 3],
    [/::/, 2],
    [/\bOWNER\s+TO\b/i, 3],
    [/\bsearch_path\b/i, 3],
    [/\bpg_catalog\b/i, 3],
    [/\bnextval\s*\(/i, 2],
    [/\bALTER\s+TABLE\s+ONLY\b/i, 3],
    [/\bcharacter\s+varying\b/i, 2],
    [/\bUSING\s+(?:btree|gin|gist|brin|spgist)\b/i, 2],
    [/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[\s\S]*\bLANGUAGE\s+plpgsql\b/i, 3],
    [/\$[A-Za-z_]*\$/, 2],
  ],
  mysql: [
    [/`/, 3],
    [/\bAUTO_INCREMENT\b/i, 3],
    [/\bENGINE\s*=/i, 3],
    [/\bDEFAULT\s+CHARSET\b/i, 2],
    [/\bLOCK\s+TABLES\b/i, 2],
    [/\bUNSIGNED\b/i, 1],
  ],
  sqlserver: [
    [/\[[A-Za-z_][^\]\n]*\]/, 2],
    [/\bIDENTITY\s*\(\s*\d/i, 3],
    [/^\s*GO\s*$/im, 4],
    [/\bNVARCHAR\b/i, 2],
    [/\bdbo\s*\]?\s*\./i, 3],
    [/\bSET\s+ANSI_NULLS\b/i, 3],
    [/\b(?:NON)?CLUSTERED\b/i, 2],
  ],
  sqlite: [
    [/\bAUTOINCREMENT\b/i, 4],
    [/\bWITHOUT\s+ROWID\b/i, 4],
    [/\bPRAGMA\b/i, 4],
    [/\bsqlite_\w+/i, 3],
  ],
  duckdb: [
    [/\b(?:U?HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)\b/i, 4],
    [/\bSTRUCT\s*\(/i, 3],
    [/\bMAP\s*\(/i, 2],
    [/\bCREATE\s+OR\s+REPLACE\s+TABLE\b/i, 3],
    [/\bCREATE\s+(?:OR\s+REPLACE\s+)?MACRO\b/i, 4],
    [/^\s*(?:INSTALL|LOAD)\s+\w+\s*;/im, 3],
  ],
};

/** The script without its strings and comments, so their contents don't count as syntax. */
function code(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|''|\\.)*'/g, "''");
}

/** The dialect a script most likely uses, from its syntax; PostgreSQL when nothing points elsewhere. */
export function detectDialect(sql: string): SqlDialect {
  const text = code(sql);
  const scores: Record<SqlDialect, number> = { postgres: 0, mysql: 0, sqlserver: 0, sqlite: 0, duckdb: 0 };
  if (/\/\*!\d{5}/.test(sql)) scores.mysql += 3;
  for (const d of SQL_DIALECT_VALUES) for (const [re, weight] of SIGNS[d]) if (re.test(text)) scores[d] += weight;
  let best: SqlDialect = 'postgres';
  for (const d of SQL_DIALECT_VALUES) if (scores[d] > scores[best]) best = d;
  return best;
}
