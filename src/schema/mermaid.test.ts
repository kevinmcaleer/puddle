import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeMermaid } from './mermaid';
import { parseDbml } from './parse';

const shop = parseDbml(readFileSync('tests/fixtures/dbml/shop.dbml', 'utf8')).schema;

describe('the schema as Mermaid', () => {
  it('writes each table with typed columns and key marks, and each ref with its ends', () => {
    expect(writeMermaid(shop)).toBe(`erDiagram
  customers {
    integer id PK
    varchar(255) email UK
    varchar(100) name
    char(2) country
    timestamp created_at
  }
  orders {
    integer id PK
    integer customer_id FK
    order_status status
    decimal(10-2) total
    timestamp ordered_at
  }
  products {
    integer id PK
    varchar(32) sku UK
    varchar name
    decimal(10-2) price
  }
  order_items {
    integer order_id FK
    integer product_id FK
    integer quantity
  }
  orders }o--|| customers : "customer_id"
  order_items }o--|| orders : "order_id"
  order_items }o--|| products : "product_id"
`);
  });

  it('marks optional sides with o, and writes many to many and one to one', () => {
    const s = parseDbml('Table a {\n  id int [pk]\n  b_id int\n}\nTable b {\n  id int [pk]\n}\nRef: a.b_id ?> b.id\nRef: a.id - b.id\nRef: a.id <> b.id').schema;
    const lines = writeMermaid(s).split('\n').filter((l) => l.includes('--'));
    expect(lines).toEqual(['  a }o--o| b : "b_id"', '  a ||--|| b : "id"', '  a }o--o{ b : "id"']);
  });

  it('follows the view: only its tables, and at Keys only key columns', () => {
    const out = writeMermaid(shop, { detail: 'keys', only: new Set(['table:public.orders', 'table:public.customers']) });
    expect(out).toContain('  orders {\n    integer id PK\n    integer customer_id FK\n  }');
    expect(out).not.toContain('products');
    expect(out).not.toContain('order_items');
    expect(writeMermaid(shop, { detail: 'names' })).toContain('\n  customers\n');
  });
});
