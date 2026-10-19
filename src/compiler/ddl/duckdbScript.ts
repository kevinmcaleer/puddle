// How a schema is written for DuckDB as a script to run elsewhere: its own enum types, a sequence for each column that
// increments, and notes as comments. (duckdb.ts builds the schema inside Puddle, in prefixed schemas; this is the plain one.)
import { ident, str } from '../sql';
import { duckdbType } from './duckdb';
import type { DialectRules } from './script';
import { decimalArgs, type TypeKind } from './types';

const INT = { 1: 'tinyint', 2: 'smallint', 4: 'integer', 8: 'bigint' } as const;

export const DUCKDB: DialectRules = {
  dialect: 'duckdb',
  label: 'DuckDB',
  type: (t: TypeKind) => {
    switch (t.kind) {
      case 'varchar':
      case 'char':
      case 'text':
      case 'json':
        return 'varchar';
      case 'int':
        return INT[t.bytes];
      case 'decimal':
        return `decimal${decimalArgs(t)}`;
      case 'float':
        return 'float';
      default:
        return t.kind;
    }
  },
  native: (type) => !duckdbType(type).unknown,
  enums: 'type',
  increment: (_type, { table, column }) => {
    const name = `${table.name}_${column.name}_seq`;
    const seq = table.schema === 'public' ? ident(name) : `${ident(table.schema)}.${ident(name)}`;
    return { clause: `DEFAULT nextval(${str(seq)})`, before: [`CREATE SEQUENCE IF NOT EXISTS ${seq};`] };
  },
  bool: (v) => (v ? 'true' : 'false'),
  comments: 'lines',
  inlineForeignKeys: 'parents-first',
  foreignKeysAcrossSchemas: false,
  schemas: { create: (name) => [`CREATE SCHEMA IF NOT EXISTS ${name};`] },
  actions: ['restrict', 'no action'],
};
