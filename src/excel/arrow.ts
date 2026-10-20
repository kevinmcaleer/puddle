// Sheet columns to an Arrow IPC stream, which DuckDB loads as a table (insertArrowFromIPCStream).
import { Binary, Bool, DateDay, Field, Float64, Int64, makeData, Schema, Table, tableToIPC, TimestampMicrosecond, Utf8, Vector, vectorFromArray, type DataType } from 'apache-arrow';
import type { SheetColumn } from './types';

const ARROW: Record<SheetColumn['type'], () => DataType> = {
  BIGINT: () => new Int64(),
  DOUBLE: () => new Float64(),
  DATE: () => new DateDay(),
  TIMESTAMP: () => new TimestampMicrosecond(),
  BOOLEAN: () => new Bool(),
  VARCHAR: () => new Utf8(),
  BLOB: () => new Binary(),
};

/** Microsecond timestamps built directly: vectorFromArray would read Date objects as milliseconds. */
function timestamps(values: SheetColumn['values']): Vector {
  const data = new BigInt64Array(values.length);
  const valid = new Uint8Array(Math.ceil(values.length / 8));
  let nulls = 0;
  values.forEach((v, i) => {
    if (v == null) nulls++;
    else {
      data[i] = BigInt(v as number) * 1000n;
      valid[i >> 3]! |= 1 << (i & 7);
    }
  });
  return new Vector([makeData({ type: new TimestampMicrosecond(), length: values.length, nullCount: nulls, nullBitmap: nulls ? valid : null, data })]);
}

function vectorOf(column: SheetColumn): Vector {
  const v = column.values;
  switch (column.type) {
    case 'BIGINT':
      return vectorFromArray(v.map((x) => (x == null ? null : BigInt(x as number))), new Int64());
    case 'DATE':
      return vectorFromArray(v.map((x) => (x == null ? null : new Date((x as number) * 86_400_000))), new DateDay());
    case 'TIMESTAMP':
      return timestamps(v);
    case 'DOUBLE':
      return vectorFromArray(v as (number | null)[], new Float64());
    case 'BOOLEAN':
      return vectorFromArray(v as (boolean | null)[], new Bool());
    case 'BLOB':
      return vectorFromArray(v as (Uint8Array | null)[], new Binary());
    default:
      return vectorFromArray(v as (string | null)[], new Utf8());
  }
}

/** An Arrow table with one nullable column per sheet column, in order. */
export function sheetTable(columns: SheetColumn[]): Table {
  if (!columns.length) return new Table(new Schema([]));
  const rows = columns[0]!.values.length;
  if (!rows) return new Table(new Schema(columns.map((c) => new Field(c.name, ARROW[c.type](), true))));
  return new Table(Object.fromEntries(columns.map((c) => [c.name, vectorOf(c)])));
}

/** The columns as an Arrow IPC stream. */
export const sheetToIPC = (columns: SheetColumn[]): Uint8Array => tableToIPC(sheetTable(columns), 'stream');
