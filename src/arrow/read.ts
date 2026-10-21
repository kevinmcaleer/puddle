// Arrow IPC files read by the Arrow library: the file as a table, and the table as typed columns, the shape a sheet
// or an Access table takes (src/excel/types.ts), for the runner, which writes them as CSV and has DuckDB load them
// with their types (compileAccessLoad). The browser hands DuckDB the Arrow bytes themselves (src/sources/arrow.ts).
// Pure.
import { DataType, tableFromIPC, type Table } from 'apache-arrow';
import type { SheetColumn, SheetColumnType } from '../excel/types';

/** An Arrow file's bytes as a table, whether the file holds the file format (ARROW1) or a bare stream. */
export function readArrowFile(bytes: Uint8Array): Table {
  try {
    return tableFromIPC(bytes);
  } catch (e) {
    throw new Error(`This file isn’t an Arrow IPC file Puddle can read (${e instanceof Error ? e.message : String(e)}). Save it again as an Arrow or Feather file, or export it as Parquet or CSV.`);
  }
}

/** The DuckDB type an Arrow column is loaded as on the runner. */
export function arrowColumnType(type: DataType): SheetColumnType {
  if (DataType.isDictionary(type)) return arrowColumnType(type.dictionary);
  if (DataType.isBool(type)) return 'BOOLEAN';
  if (DataType.isInt(type)) return 'BIGINT';
  if (DataType.isFloat(type) || DataType.isDecimal(type)) return 'DOUBLE';
  if (DataType.isDate(type)) return 'DATE';
  if (DataType.isTimestamp(type)) return 'TIMESTAMP';
  if (DataType.isBinary(type) || DataType.isLargeBinary(type) || DataType.isFixedSizeBinary(type)) return 'BLOB';
  return 'VARCHAR';
}

/** One value as the column's type keeps it: dates as days, timestamps as milliseconds, structured values as JSON. */
function value(v: unknown, type: SheetColumnType): SheetColumn['values'][number] {
  if (v == null) return null;
  if (type === 'DATE') return Math.floor((v as number) / 86_400_000);
  if (type === 'TIMESTAMP') return v as number;
  if (type === 'BIGINT') return typeof v === 'bigint' ? v.toString() : (v as number);
  if (type === 'DOUBLE') return typeof v === 'number' ? v : Number(v);
  if (type === 'BOOLEAN') return Boolean(v);
  if (type === 'BLOB') return v instanceof Uint8Array ? v : new Uint8Array(v as ArrayLike<number>);
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return v.toString();
  const json = typeof (v as { toJSON?: unknown }).toJSON === 'function' ? (v as { toJSON: () => unknown }).toJSON() : v;
  return typeof json === 'string' ? json : JSON.stringify(json, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
}

/** The table's columns with their DuckDB types and values. */
export function arrowColumns(table: Table): (SheetColumn & { sqlType: string })[] {
  return table.schema.fields.map((field, i) => {
    const type = arrowColumnType(field.type);
    const vector = table.getChildAt(i)!;
    const values: SheetColumn['values'] = [];
    for (let r = 0; r < table.numRows; r++) values.push(value(vector.get(r), type));
    return { name: field.name, type, sqlType: type, values };
  });
}
