// How a schema is written for SQLite: its few storage types, foreign keys inside CREATE TABLE (it can't add them
// later), AUTOINCREMENT on an integer primary key only, enums as checks on the values, and no schemas.
import type { DialectRules } from './script';
import type { TypeKind } from './types';

export const SQLITE: DialectRules = {
  dialect: 'sqlite',
  label: 'SQLite',
  type: (t: TypeKind) => {
    switch (t.kind) {
      case 'int':
      case 'boolean':
        return 'integer';
      case 'decimal':
        return 'numeric';
      case 'float':
      case 'double':
        return 'real';
      case 'blob':
        return 'blob';
      default:
        return 'text';
    }
  },
  // It takes any type name, so a type it has no word for is still written as given without a notice.
  native: () => true,
  enums: 'check',
  increment: (_type, at) => (at.single ? { type: 'integer', clause: 'PRIMARY KEY AUTOINCREMENT', primaryKey: true } : undefined),
  bool: (v) => (v ? '1' : '0'),
  comments: 'lines',
  inlineForeignKeys: 'any-order',
  schemas: 'none',
  actions: ['cascade', 'restrict', 'set null', 'set default', 'no action'],
};
