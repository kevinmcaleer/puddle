// SQL Server's types as Puddle loads them: the Arrow type the values cross in and the DuckDB type the table is created
// with, from a result column's metadata (as tedious names it, where a nullable int is an IntN of 4 bytes) or an
// INFORMATION_SCHEMA.COLUMNS row. Pure, so the mapping is tested without a server. Values arrive from the client as
// text (dates, times, fixed-point numbers, big integers), numbers, booleans or bytes, and `convertSqlserverValue`
// turns them into what src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';
import { dateDays, timestampMs } from './pgTypes';

export interface SqlserverType {
  type: SheetColumnType;
  sqlType: string;
}

/** A result column as tedious describes it: the type's name, and its length, precision and scale where they matter. */
export interface SqlserverField {
  name: string;
  type: string;
  dataLength?: number;
  precision?: number;
  scale?: number;
}

const TEXT: SqlserverType = { type: 'VARCHAR', sqlType: 'VARCHAR' };
const decimal = (precision: number | undefined, scale: number | undefined): SqlserverType => (precision && precision <= 38 ? { type: 'VARCHAR', sqlType: `DECIMAL(${precision},${scale ?? 0})` } : { type: 'DOUBLE', sqlType: 'DOUBLE' });

/** The type of a query's result column. */
export function sqlserverFieldType(f: SqlserverField): SqlserverType {
  switch (f.type) {
    case 'Int':
      return { type: 'BIGINT', sqlType: 'INTEGER' };
    case 'BigInt':
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'SmallInt':
    case 'TinyInt':
      return { type: 'BIGINT', sqlType: 'SMALLINT' };
    case 'IntN':
      return { type: 'BIGINT', sqlType: f.dataLength === 8 ? 'BIGINT' : f.dataLength === 4 ? 'INTEGER' : 'SMALLINT' };
    case 'Bit':
    case 'BitN':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'Decimal':
    case 'DecimalN':
    case 'Numeric':
    case 'NumericN':
      return decimal(f.precision, f.scale);
    case 'Money':
      return decimal(19, 4);
    case 'SmallMoney':
      return decimal(10, 4);
    case 'MoneyN':
      return f.dataLength === 4 ? decimal(10, 4) : decimal(19, 4);
    case 'Float':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'Real':
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case 'FloatN':
      return { type: 'DOUBLE', sqlType: f.dataLength === 4 ? 'FLOAT' : 'DOUBLE' };
    case 'Date':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'DateTime':
    case 'DateTimeN':
    case 'SmallDateTime':
    case 'DateTime2':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'DateTimeOffset':
      return { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' };
    case 'Time':
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case 'UniqueIdentifier':
      return { type: 'VARCHAR', sqlType: 'UUID' };
    case 'Binary':
    case 'VarBinary':
    case 'Image':
    case 'UDT':
      return { type: 'BLOB', sqlType: 'BLOB' };
    default:
      // Char, VarChar, NChar, NVarChar, Text, NText, Xml, Variant and anything new are text.
      return TEXT;
  }
}

/** A column as INFORMATION_SCHEMA.COLUMNS describes it. */
export interface SqlserverColumnRow {
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH?: number | null;
  NUMERIC_PRECISION?: number | null;
  NUMERIC_SCALE?: number | null;
  DATETIME_PRECISION?: number | null;
}

/** The type of a catalogued column, and how its declaration reads (the DBML type). */
export function sqlserverColumnType(c: SqlserverColumnRow): SqlserverType & { declared: string } {
  const t = c.DATA_TYPE.toLowerCase();
  const length = c.CHARACTER_MAXIMUM_LENGTH;
  const sized = `${t}(${length === -1 ? 'max' : length})`;
  switch (t) {
    case 'int':
      return { type: 'BIGINT', sqlType: 'INTEGER', declared: t };
    case 'bigint':
      return { type: 'BIGINT', sqlType: 'BIGINT', declared: t };
    case 'smallint':
    case 'tinyint':
      return { type: 'BIGINT', sqlType: 'SMALLINT', declared: t };
    case 'bit':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN', declared: t };
    case 'decimal':
    case 'numeric':
      return { ...decimal(c.NUMERIC_PRECISION ?? undefined, c.NUMERIC_SCALE ?? undefined), declared: `${t}(${c.NUMERIC_PRECISION ?? 18},${c.NUMERIC_SCALE ?? 0})` };
    case 'money':
      return { ...decimal(19, 4), declared: t };
    case 'smallmoney':
      return { ...decimal(10, 4), declared: t };
    case 'float':
      return { type: 'DOUBLE', sqlType: 'DOUBLE', declared: t };
    case 'real':
      return { type: 'DOUBLE', sqlType: 'FLOAT', declared: t };
    case 'date':
      return { type: 'DATE', sqlType: 'DATE', declared: t };
    case 'datetime':
    case 'smalldatetime':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP', declared: t };
    case 'datetime2':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP', declared: c.DATETIME_PRECISION != null ? `${t}(${c.DATETIME_PRECISION})` : t };
    case 'datetimeoffset':
      return { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE', declared: c.DATETIME_PRECISION != null ? `${t}(${c.DATETIME_PRECISION})` : t };
    case 'time':
      return { type: 'VARCHAR', sqlType: 'TIME', declared: c.DATETIME_PRECISION != null ? `${t}(${c.DATETIME_PRECISION})` : t };
    case 'uniqueidentifier':
      return { type: 'VARCHAR', sqlType: 'UUID', declared: t };
    case 'char':
    case 'varchar':
    case 'nchar':
    case 'nvarchar':
      return { ...TEXT, declared: length != null ? sized : t };
    case 'binary':
    case 'varbinary':
      return { type: 'BLOB', sqlType: 'BLOB', declared: length != null ? sized : t };
    case 'image':
    case 'geography':
    case 'geometry':
    case 'hierarchyid':
      return { type: 'BLOB', sqlType: 'BLOB', declared: t };
    case 'json':
      return { type: 'VARCHAR', sqlType: 'JSON', declared: t };
    default:
      // text, ntext, xml, sql_variant and anything new are text.
      return { ...TEXT, declared: t };
  }
}

/** One value as the client gave it (text, a number, a boolean, bytes, or null) for its column's Arrow type. */
export function convertSqlserverValue(v: unknown, type: SheetColumnType): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return type === 'BLOB' ? v : new TextDecoder().decode(v);
  switch (type) {
    case 'BIGINT': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isSafeInteger(n) ? n : null;
    }
    case 'DOUBLE': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isNaN(n) ? null : n;
    }
    case 'BOOLEAN':
      return typeof v === 'boolean' ? v : v === 1 || v === '1' || v === 'true' ? true : v === 0 || v === '0' || v === 'false' ? false : null;
    case 'DATE':
      return dateDays(String(v));
    case 'TIMESTAMP':
      return timestampMs(String(v));
    case 'BLOB':
      return new TextEncoder().encode(String(v));
    default:
      return String(v);
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A Date tedious made (in UTC, as the connection asks) written back as the database's wall-clock text. */
export function utcText(d: Date, kind: 'date' | 'time' | 'timestamp'): string {
  const ymd = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  return kind === 'date' ? ymd : kind === 'time' ? hms : `${ymd} ${hms}`;
}
