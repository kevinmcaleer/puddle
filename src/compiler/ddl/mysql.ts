// How a schema is written for MySQL and MariaDB: ENUM columns, AUTO_INCREMENT and COMMENT clauses. A schema is a
// database there, created with CREATE SCHEMA.
import type { DialectRules } from './script';
import { decimalArgs, type TypeKind } from './types';

const INT = { 1: 'tinyint', 2: 'smallint', 4: 'int', 8: 'bigint' } as const;

export const MYSQL: DialectRules = {
  dialect: 'mysql',
  label: 'MySQL',
  type: (t: TypeKind) => {
    switch (t.kind) {
      case 'varchar':
        return `varchar(${t.length ?? 255})`;
      case 'char':
        return `char(${t.length ?? 1})`;
      case 'int':
        return INT[t.bytes];
      case 'decimal':
        return `decimal${decimalArgs(t)}`;
      case 'timestamp':
      case 'timestamptz':
        return 'datetime';
      case 'uuid':
        return 'char(36)';
      case 'interval':
        return undefined;
      default:
        return t.kind;
    }
  },
  native: (type) => /^(year|set\(.*\)|tinyblob|mediumblob|longblob|tinytext|mediumtext|longtext|(tiny|small|medium|big)?int unsigned)$/i.test(type),
  enums: 'column',
  increment: () => ({ clause: 'AUTO_INCREMENT' }),
  bool: (v) => (v ? 'true' : 'false'),
  comments: 'clause',
  schemas: { create: (name) => [`CREATE SCHEMA IF NOT EXISTS ${name};`] },
  actions: ['cascade', 'restrict', 'set null', 'no action'],
};
