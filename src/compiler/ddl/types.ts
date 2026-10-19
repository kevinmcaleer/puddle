// DBML column types read into a few kinds every database has a word for, so each dialect can write its own: a
// `varchar(255)` is `nvarchar(255)` in SQL Server and `text` in SQLite. A type outside these kinds is written as given.

export type TypeKind =
  | { kind: 'varchar'; length?: number }
  | { kind: 'char'; length?: number }
  | { kind: 'text' }
  | { kind: 'int'; bytes: 1 | 2 | 4 | 8 }
  | { kind: 'decimal'; precision?: number; scale?: number }
  | { kind: 'float' }
  | { kind: 'double' }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'time' }
  | { kind: 'timestamp' }
  | { kind: 'timestamptz' }
  | { kind: 'uuid' }
  | { kind: 'json' }
  | { kind: 'blob' }
  | { kind: 'interval' };

const WORDS: Record<string, TypeKind> = {
  varchar: { kind: 'varchar' }, 'character varying': { kind: 'varchar' }, nvarchar: { kind: 'varchar' }, string: { kind: 'varchar' },
  char: { kind: 'char' }, character: { kind: 'char' }, nchar: { kind: 'char' },
  text: { kind: 'text' }, ntext: { kind: 'text' }, tinytext: { kind: 'text' }, mediumtext: { kind: 'text' }, longtext: { kind: 'text' }, clob: { kind: 'text' }, citext: { kind: 'text' },
  tinyint: { kind: 'int', bytes: 1 }, int1: { kind: 'int', bytes: 1 },
  smallint: { kind: 'int', bytes: 2 }, int2: { kind: 'int', bytes: 2 }, smallserial: { kind: 'int', bytes: 2 },
  int: { kind: 'int', bytes: 4 }, integer: { kind: 'int', bytes: 4 }, int4: { kind: 'int', bytes: 4 }, mediumint: { kind: 'int', bytes: 4 }, serial: { kind: 'int', bytes: 4 },
  bigint: { kind: 'int', bytes: 8 }, int8: { kind: 'int', bytes: 8 }, bigserial: { kind: 'int', bytes: 8 }, long: { kind: 'int', bytes: 8 },
  decimal: { kind: 'decimal' }, numeric: { kind: 'decimal' }, dec: { kind: 'decimal' }, number: { kind: 'decimal' }, money: { kind: 'decimal', precision: 19, scale: 4 },
  float: { kind: 'float' }, float4: { kind: 'float' }, real: { kind: 'float' },
  double: { kind: 'double' }, float8: { kind: 'double' }, 'double precision': { kind: 'double' },
  bool: { kind: 'boolean' }, boolean: { kind: 'boolean' }, bit: { kind: 'boolean' },
  date: { kind: 'date' },
  time: { kind: 'time' }, 'time without time zone': { kind: 'time' },
  timestamp: { kind: 'timestamp' }, datetime: { kind: 'timestamp' }, datetime2: { kind: 'timestamp' }, smalldatetime: { kind: 'timestamp' }, 'timestamp without time zone': { kind: 'timestamp' },
  timestamptz: { kind: 'timestamptz' }, 'timestamp with time zone': { kind: 'timestamptz' }, datetimeoffset: { kind: 'timestamptz' },
  uuid: { kind: 'uuid' }, uniqueidentifier: { kind: 'uuid' },
  json: { kind: 'json' }, jsonb: { kind: 'json' },
  blob: { kind: 'blob' }, bytea: { kind: 'blob' }, binary: { kind: 'blob' }, varbinary: { kind: 'blob' }, longblob: { kind: 'blob' }, mediumblob: { kind: 'blob' }, tinyblob: { kind: 'blob' }, image: { kind: 'blob' },
  interval: { kind: 'interval' },
};

/** The kind of a DBML type, or undefined when it isn't one of the common ones (or is an array). */
export function typeKind(type: string): TypeKind | undefined {
  const m = /^([a-z_][a-z0-9_ ]*?)\s*(?:\(\s*([^)]*)\))?(?:\s+(with(?:out)? time zone))?$/i.exec(type.trim());
  if (!m) return undefined;
  let base = m[1]!.toLowerCase().replace(/\s+/g, ' ');
  if (m[3]) base = `${base.replace(/tz$/, '')} ${m[3].toLowerCase()}`;
  const known = WORDS[base];
  if (!known) return undefined;
  const args = (m[2] ?? '').split(',').map((a) => a.trim()).filter(Boolean).map(Number);
  const whole = (n: number | undefined) => (n != null && Number.isInteger(n) && n > 0 ? n : undefined);
  if (known.kind === 'varchar' || known.kind === 'char') return { kind: known.kind, length: whole(args[0]) };
  if (known.kind === 'decimal' && args.length) return { kind: 'decimal', precision: whole(args[0]), scale: args[1] != null && Number.isInteger(args[1]) && args[1] >= 0 ? args[1] : undefined };
  if (known.kind === 'float' && args[0] != null && args[0] > 24) return { kind: 'double' };
  return known;
}

/** `(p,s)` for a decimal that has them. */
export const decimalArgs = (t: { precision?: number; scale?: number }) => (t.precision ? `(${t.precision}${t.scale != null ? `,${t.scale}` : ''})` : '');
