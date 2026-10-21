// A driver's Arrow IPC stream as DuckDB's native build takes it: the stream is read with apache-arrow, each column
// gets the DuckDB type its Arrow type stands for, and the values are handed to an appender one by one. The browser
// engine takes the stream whole (insertArrowFromIPCStream); the native binding has no such call, so this is its
// side of the same load, before the compiler casts the staging table to the types the driver declared.
import { DataType, tableFromIPC, Type, type Table, type Vector } from 'apache-arrow';

export type StagingType = 'BIGINT' | 'DOUBLE' | 'DATE' | 'TIMESTAMP' | 'BOOLEAN' | 'VARCHAR' | 'BLOB';

/** A value as the appender takes it for the column's staging type: a bigint for BIGINT, days for DATE, microseconds for TIMESTAMP. */
export type StagingValue = bigint | number | boolean | string | Uint8Array | null;

export interface StagingColumn {
  name: string;
  sqlType: StagingType;
}

/** The DuckDB type a column of the stream is staged as; anything the drivers don't produce is staged as its text. */
export function stagingType(type: DataType): StagingType {
  if (DataType.isInt(type)) return 'BIGINT';
  if (DataType.isFloat(type)) return 'DOUBLE';
  if (DataType.isDate(type)) return 'DATE';
  if (DataType.isTimestamp(type)) return 'TIMESTAMP';
  if (DataType.isBool(type)) return 'BOOLEAN';
  if (DataType.isBinary(type) || DataType.isLargeBinary(type)) return 'BLOB';
  return 'VARCHAR';
}

const DAY_MS = 86_400_000;

/** The scale to microseconds of a timestamp unit (seconds, milliseconds, microseconds, nanoseconds). */
const toMicros = (type: DataType, raw: bigint): bigint => {
  const unit = (type as { unit?: number }).unit ?? 2;
  // apache-arrow's TimeUnit: SECOND 0, MILLISECOND 1, MICROSECOND 2, NANOSECOND 3.
  return unit === 0 ? raw * 1_000_000n : unit === 1 ? raw * 1000n : unit === 3 ? raw / 1000n : raw;
};

/** One value of a vector as the staging column takes it, or null. */
export function stagingValue(vector: Vector, i: number, sqlType: StagingType): StagingValue {
  if (!vector.isValid(i)) return null;
  const v: unknown = vector.get(i);
  if (v == null) return null;
  switch (sqlType) {
    case 'BIGINT':
      return typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)));
    case 'DOUBLE':
      return Number(v);
    case 'DATE': {
      // A date comes back as the milliseconds of its midnight (DateDay and DateMillisecond alike).
      const ms = v instanceof Date ? v.getTime() : Number(v);
      return Math.round(ms / DAY_MS);
    }
    case 'TIMESTAMP': {
      // The raw unit value is in the data buffer, so no precision is lost on the way to microseconds.
      const data = vector.data.find((d) => i >= d.offset && i < d.offset + d.length);
      const values = data?.values as BigInt64Array | Int32Array | undefined;
      if (data && values && values.length) {
        const raw = values[i - data.offset]!;
        return toMicros(vector.type, typeof raw === 'bigint' ? raw : BigInt(raw));
      }
      return BigInt(v instanceof Date ? v.getTime() : Math.trunc(Number(v))) * 1000n;
    }
    case 'BOOLEAN':
      return Boolean(v);
    case 'BLOB':
      return v instanceof Uint8Array ? v : new TextEncoder().encode(String(v));
    default:
      return typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)) : String(v);
  }
}

/** The stream read whole, with the staging column each of its columns gets. */
export function stagingOf(ipc: Uint8Array): { table: Table; columns: StagingColumn[] } {
  const table = tableFromIPC(ipc);
  return { table, columns: table.schema.fields.map((f) => ({ name: f.name, sqlType: stagingType(f.type) })) };
}

/** Each row of the table as staging values, column by column, in order. */
export function* stagingRows(table: Table, columns: StagingColumn[]): Generator<StagingValue[]> {
  const vectors = columns.map((_, j) => table.getChildAt(j)!);
  for (let i = 0; i < table.numRows; i++) yield vectors.map((v, j) => stagingValue(v, i, columns[j]!.sqlType));
}

/** For tests: the Arrow type ids the drivers produce. */
export const ARROW_TYPE = Type;
