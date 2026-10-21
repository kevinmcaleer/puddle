// SAP HANA's types as DuckDB holds them: the protocol's type codes (node-hdb's lib/protocol/common/TypeCode) named,
// then named types mapped, with the precision and scale a DECIMAL declares.
import type { SheetColumnType } from '../../excel/types';

export interface HanaType {
  type: SheetColumnType;
  sqlType: string;
}

/** A result column as node-hdb describes it, kept by the recordings. */
export interface HanaField {
  name: string;
  /** The protocol's type code. */
  dataType: number;
  /** The scale (DECIMAL) or fractional seconds. */
  fraction?: number;
  /** The precision (DECIMAL) or length. */
  length?: number;
}

const CODE_NAMES: Record<number, string> = {
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INTEGER',
  4: 'BIGINT',
  5: 'DECIMAL',
  6: 'REAL',
  7: 'DOUBLE',
  8: 'CHAR',
  9: 'VARCHAR',
  10: 'NCHAR',
  11: 'NVARCHAR',
  12: 'BINARY',
  13: 'VARBINARY',
  14: 'DATE',
  15: 'TIME',
  16: 'TIMESTAMP',
  25: 'CLOB',
  26: 'NCLOB',
  27: 'BLOB',
  28: 'BOOLEAN',
  29: 'STRING',
  30: 'NSTRING',
  33: 'BSTRING',
  35: 'VARCHAR',
  51: 'TEXT',
  52: 'SHORTTEXT',
  53: 'BINTEXT',
  55: 'ALPHANUM',
  61: 'TIMESTAMP',
  62: 'SECONDDATE',
  63: 'DATE',
  64: 'TIME',
  71: 'SMALLDECIMAL',
  74: 'ST_GEOMETRY',
  75: 'ST_POINT',
  76: 'FIXED16',
  81: 'FIXED8',
  82: 'FIXED12',
};

/** The name of a protocol type code. */
export const codeName = (code: number): string => CODE_NAMES[code] ?? `TYPE${code}`;

const BIGINT: HanaType = { type: 'BIGINT', sqlType: 'BIGINT' };
const DOUBLE: HanaType = { type: 'DOUBLE', sqlType: 'DOUBLE' };
const VARCHAR: HanaType = { type: 'VARCHAR', sqlType: 'VARCHAR' };

/** The DuckDB type a named HANA type loads as; a DECIMAL with a scale is exact, one without (a floating DECIMAL) a double. */
export function hanaNamedType(name: string, length?: number | null, scale?: number | null): HanaType {
  const t = name.toUpperCase();
  switch (t) {
    case 'TINYINT':
    case 'SMALLINT':
    case 'INTEGER':
    case 'INT':
    case 'BIGINT':
      return BIGINT;
    case 'DECIMAL':
    case 'FIXED8':
    case 'FIXED12':
    case 'FIXED16': {
      const p = Number(length ?? 0);
      const s = Number(scale ?? 0);
      if (!p || p > 38 || s < 0 || s > p || (t === 'DECIMAL' && !length)) return DOUBLE;
      return { type: 'VARCHAR', sqlType: `DECIMAL(${p},${s})` };
    }
    case 'SMALLDECIMAL':
    case 'REAL':
    case 'DOUBLE':
      return DOUBLE;
    case 'BOOLEAN':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'DATE':
    case 'DAYDATE':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'TIME':
    case 'SECONDTIME':
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case 'TIMESTAMP':
    case 'SECONDDATE':
    case 'LONGDATE':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'BINARY':
    case 'VARBINARY':
    case 'BLOB':
    case 'BSTRING':
      return { type: 'BLOB', sqlType: 'BLOB' };
    default:
      return VARCHAR;
  }
}

/** The DuckDB type a result column loads as. */
export const hanaFieldType = (f: HanaField): HanaType => hanaNamedType(codeName(f.dataType), f.length, f.fraction);

/** A column of SYS.TABLE_COLUMNS, as the catalogue reads it. */
export interface HanaColumnRow {
  DATA_TYPE_NAME: string;
  LENGTH?: number | string | null;
  SCALE?: number | string | null;
}

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** A catalogue column's DuckDB type and its type as declared ("DECIMAL(10,2)", "NVARCHAR(255)"). */
export function hanaColumnType(c: HanaColumnRow): HanaType & { declared: string } {
  const t = c.DATA_TYPE_NAME.toUpperCase();
  const length = num(c.LENGTH);
  const scale = num(c.SCALE);
  let declared = t;
  if (t === 'DECIMAL') declared = length ? `DECIMAL(${length},${scale ?? 0})` : 'DECIMAL';
  else if (/^(N?VARCHAR|N?CHAR|VARBINARY|BINARY|ALPHANUM|SHORTTEXT)$/.test(t) && length) declared = `${t}(${length})`;
  return { ...hanaNamedType(t, length, scale), declared };
}

const DAY_MS = 86_400_000;

/** A value as node-hdb gives it (dates and timestamps as text, decimals as text, big integers as numbers or text) for its column's type. */
export function convertHanaValue(v: unknown, type: SheetColumnType): number | string | boolean | Uint8Array | null {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'BIGINT':
      return typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : typeof v === 'boolean' ? (v ? 1 : 0) : null;
    case 'DOUBLE':
      return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
    case 'BOOLEAN':
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : typeof v === 'string' ? /^(1|true)$/i.test(v) : null;
    case 'DATE': {
      const ms = typeof v === 'string' ? Date.parse(`${v.slice(0, 10)}T00:00:00Z`) : v instanceof Date ? v.getTime() : NaN;
      return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
    }
    case 'TIMESTAMP': {
      const ms = typeof v === 'string' ? Date.parse(`${v.replace(' ', 'T')}${/Z$|[+-]\d\d:\d\d$/.test(v) ? '' : 'Z'}`) : v instanceof Date ? v.getTime() : NaN;
      return Number.isNaN(ms) ? null : ms;
    }
    case 'BLOB':
      return v instanceof Uint8Array ? v : null;
    default:
      return v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}
