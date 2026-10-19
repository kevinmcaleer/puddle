// How a schema is written for SQL Server (T-SQL): Unicode text types, bit for booleans, IDENTITY, enums as checks on
// the values, and notes as comments. CREATE SCHEMA has to be alone in its batch, so GO follows it.
import type { DialectRules } from './script';
import { decimalArgs, type TypeKind } from './types';

const INT = { 1: 'tinyint', 2: 'smallint', 4: 'int', 8: 'bigint' } as const;

export const SQLSERVER: DialectRules = {
  dialect: 'sqlserver',
  label: 'SQL Server',
  type: (t: TypeKind) => {
    switch (t.kind) {
      case 'varchar':
        return t.length && t.length <= 4000 ? `nvarchar(${t.length})` : 'nvarchar(max)';
      case 'char':
        return `nchar(${t.length ?? 1})`;
      case 'text':
      case 'json':
        return 'nvarchar(max)';
      case 'int':
        return INT[t.bytes];
      case 'decimal':
        return `decimal${decimalArgs(t)}`;
      case 'double':
        return 'float';
      case 'boolean':
        return 'bit';
      case 'timestamp':
        return 'datetime2';
      case 'timestamptz':
        return 'datetimeoffset';
      case 'uuid':
        return 'uniqueidentifier';
      case 'blob':
        return 'varbinary(max)';
      case 'interval':
        return undefined;
      default:
        return t.kind;
    }
  },
  native: (type) => /^(money|smallmoney|xml|rowversion|hierarchyid|geography|geometry|sql_variant)$/i.test(type),
  enums: 'check',
  increment: () => ({ clause: 'IDENTITY(1,1)' }),
  bool: (v) => (v ? '1' : '0'),
  comments: 'lines',
  schemas: { create: (name) => [`CREATE SCHEMA ${name};`, 'GO'] },
  // SQL Server has no RESTRICT; NO ACTION refuses the same changes.
  actions: ['cascade', 'set null', 'set default', 'no action'],
};
