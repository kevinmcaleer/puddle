import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DbmlSchemaZ, findTable, parseDbml, withoutRanges, writeDbml, type DbmlSchema } from '..';
import { importSql, skippedText } from '.';

const fixture = (name: string) => readFileSync(`tests/fixtures/sql/${name}`, 'utf8');
const dbml = (name: string) => writeDbml(importSql(fixture(name)).schema);
const FIXTURES = ['postgres.sql', 'mysql.sql', 'sqlserver.sql', 'sqlite.sql', 'duckdb.sql'];

/** One statement's table, read in the given dialect, checking nothing was warned about. */
function table(sql: string, dialect: Parameters<typeof importSql>[1] = 'postgres') {
  const r = importSql(sql, dialect);
  expect(r.warnings).toEqual([]);
  return r.schema.tables[0]!;
}

/** What two dialects' scripts of the same database agree on: names, keys, not null and the refs between them. */
function shape(s: DbmlSchema) {
  return {
    tables: s.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({ name: c.name, pk: c.pk, unique: c.unique, notNull: c.notNull === true, increment: c.increment })),
      keys: t.indexes.filter((ix) => ix.pk || ix.unique).map((ix) => ({ parts: ix.parts, pk: ix.pk, unique: ix.unique })),
    })),
    refs: s.refs.map((r) => ({ from: r.from, to: r.to, op: r.op, delete: r.delete, update: r.update })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

describe('importSql on real-world dumps', () => {
  it('writes the postgres fixture as DBML', () => {
    expect(dbml('postgres.sql')).toBe(`Enum order_status {
  pending
  paid
  shipped
  cancelled
}

Table customers {
  id integer [pk, increment, not null]
  email "character varying(255)" [not null, unique, note: 'Lower-cased; one account per address']
  full_name text
  created_at "timestamp with time zone" [not null, default: \`now()\`]
  is_active boolean [not null, default: true]

  indexes {
    (\`lower((email)::text)\`) [unique, name: 'customers_lower_email_idx', type: btree]
  }

  Note: 'People who buy things'
}

Table orders {
  id bigint [pk, increment, not null]
  customer_id integer [not null]
  status order_status [not null, default: 'pending']
  total numeric(10,2) [not null, default: 0]
  "note" text [default: '']
  placed_at "timestamp without time zone"

  indexes {
    customer_id [name: 'orders_customer_id_idx', type: btree]
  }

  checks {
    \`total >= (0)::numeric\` [name: 'orders_total_check']
  }
}

Table order_items {
  order_id bigint [not null]
  line_no smallint [not null]
  sku "character varying(32)" [not null]
  quantity integer [not null, default: 1]
  unit_price numeric(10,2) [not null]

  indexes {
    (order_id, line_no) [pk, name: 'order_items_pkey']
  }
}

Table billing.invoices {
  id integer [pk, increment, not null]
  order_id bigint [not null, unique]
  issued_on date [not null, default: \`CURRENT_DATE\`]
  tags text[]
}

Ref orders_customer_id_fkey: orders.customer_id > customers.id [delete: restrict]
Ref order_items_order_id_fkey: order_items.order_id > orders.id [delete: cascade, update: cascade]
Ref invoices_order_id_fkey: billing.invoices.order_id - orders.id
`);
  });

  it('writes the mysql fixture as DBML', () => {
    expect(dbml('mysql.sql')).toBe(`Table customers {
  id "int unsigned" [pk, increment, not null]
  email varchar(255) [not null, unique, note: 'Login; one account per address']
  name varchar(100) [not null]
  created_at datetime [not null, default: \`CURRENT_TIMESTAMP\`]
  updated_at datetime [default: null]

  Note: 'People who buy things'
}

Table products {
  id "int unsigned" [pk, increment, not null]
  sku varchar(32) [not null, unique]
  name varchar(200) [not null]
  price decimal(10,2) [not null, default: '0.00']
  description text

  indexes {
    name [name: 'products_name_index', type: btree]
  }
}

Table orders {
  id "int unsigned" [pk, increment, not null]
  customer_id "int unsigned" [not null]
  status varchar(20) [not null, default: 'new']
  placed_at datetime [not null]

  indexes {
    customer_id [name: 'orders_customer_id_foreign']
  }
}

Table order_items {
  order_id "int unsigned" [not null]
  product_id "int unsigned" [not null]
  quantity int [not null, default: '1']
  unit_price decimal(10,2) [not null]

  indexes {
    (order_id, product_id) [pk]
    product_id [name: 'order_items_product_id_foreign']
  }
}

Ref orders_customer_id_foreign: orders.customer_id > customers.id
Ref order_items_order_id_foreign: order_items.order_id > orders.id [delete: cascade]
Ref order_items_product_id_foreign: order_items.product_id > products.id
`);
  });

  it('writes the sqlserver fixture as DBML', () => {
    expect(dbml('sqlserver.sql')).toBe(`Table customers {
  id int [pk, increment, not null]
  email nvarchar(255) [not null, unique, note: 'Login; one account per address']
  name nvarchar(100) [not null]
  created_at datetime2(7) [not null, default: \`getdate()\`]
  updated_at datetime2(7) [null]

  Note: 'People who buy things'
}

Table products {
  id int [pk, increment, not null]
  sku nvarchar(32) [not null, unique]
  name nvarchar(200) [not null]
  price decimal(10, 2) [not null, default: 0]
  description nvarchar(max) [null]

  checks {
    \`price>=(0)\` [name: 'CK_products_price']
  }
}

Table orders {
  id int [pk, increment, not null]
  customer_id int [not null]
  status nvarchar(20) [not null, default: 'new']
  placed_at datetime2(7) [not null]

  indexes {
    customer_id [name: 'IX_orders_customer_id']
  }
}

Table order_items {
  order_id int [not null]
  product_id int [not null]
  quantity int [not null, default: 1]
  unit_price decimal(10, 2) [not null]

  indexes {
    (order_id, product_id) [pk, name: 'PK_order_items']
  }
}

Ref FK_order_items_orders: order_items.order_id > orders.id [delete: cascade]
Ref FK_order_items_products: order_items.product_id > products.id
Ref FK_orders_customers: orders.customer_id > customers.id
`);
  });

  it('writes the sqlite fixture as DBML', () => {
    expect(dbml('sqlite.sql')).toBe(`Table authors {
  id INTEGER [pk, increment]
  name TEXT [not null]
  email TEXT [unique]
  born INTEGER [check: \`born > 1000\`]
}

Table books {
  id INTEGER [pk, increment]
  author_id INTEGER [not null]
  title TEXT [not null]
  published DATE
  price REAL [default: 0.0]
  in_print BOOLEAN [not null, default: 1]

  indexes {
    author_id [name: 'idx_books_author']
    (title, author_id) [unique, name: 'idx_books_title']
  }
}

Table reviews {
  id INTEGER [pk, not null]
  book_id INTEGER [not null]
  stars INTEGER [not null, check: \`stars BETWEEN 1 AND 5\`]
  body TEXT
}

Table tags {
  book_id INTEGER [not null]
  tag TEXT [not null]

  indexes {
    (book_id, tag) [pk]
  }
}

Ref: books.author_id > authors.id [delete: cascade]
Ref: reviews.book_id > books.id [delete: cascade, update: no action]
Ref: tags.book_id > books.id
`);
  });

  it('writes the duckdb fixture as DBML', () => {
    expect(dbml('duckdb.sql')).toBe(`Enum mood {
  sad
  ok
  happy
}

Table users {
  id UBIGINT [pk]
  handle VARCHAR [not null, unique]
  current_mood mood
  address STRUCT(street VARCHAR, city VARCHAR)
  prefs MAP(VARCHAR, VARCHAR)
  tags VARCHAR[]
  created_at TIMESTAMPTZ [default: \`current_timestamp\`]
}

Table analytics.events {
  id BIGINT [pk, increment]
  user_id UBIGINT
  kind VARCHAR [not null, check: \`kind IN ('view', 'click')\`]
  payload JSON
  amount HUGEINT [default: 0]
  happened_at TIMESTAMP [not null]

  indexes {
    user_id [name: 'events_user_idx']
  }
}

Table daily {
  day DATE
  user_id UBIGINT
  views INTEGER [default: 0]

  indexes {
    (day, user_id) [pk]
  }
}

Ref: analytics.events.user_id > users.id
Ref: daily.user_id > users.id
`);
  });

  it.each(FIXTURES)('%s writes DBML that parses back to the same schema', (name) => {
    const { schema } = importSql(fixture(name));
    expect(DbmlSchemaZ.safeParse(schema).success).toBe(true);
    const back = parseDbml(writeDbml(schema));
    expect(back.errors).toEqual([]);
    expect(withoutRanges(back.schema.tables)).toEqual(schema.tables);
    expect(withoutRanges(back.schema.refs)).toEqual(schema.refs);
    expect(withoutRanges(back.schema.enums)).toEqual(schema.enums);
  });

  it.each(FIXTURES)('%s imports without warnings', (name) => {
    expect(importSql(fixture(name)).warnings).toEqual([]);
  });

  it('reads the MySQL and SQL Server scripts of the same shop to the same tables and refs', () => {
    const mysql = importSql(fixture('mysql.sql'));
    const sqlserver = importSql(fixture('sqlserver.sql'));
    expect([mysql.dialect, sqlserver.dialect]).toEqual(['mysql', 'sqlserver']);
    expect(shape(sqlserver.schema)).toEqual(shape(mysql.schema));
    expect(mysql.schema.tables.map((t) => t.name)).toEqual(['customers', 'products', 'orders', 'order_items']);
    expect(mysql.schema.refs).toHaveLength(3);
  });

  it('counts the statements it skips by kind', () => {
    expect(importSql(fixture('mysql.sql')).skipped).toEqual([
      { kind: 'DROP TABLE', count: 4 },
      { kind: 'LOCK TABLES', count: 4 },
      { kind: 'INSERT', count: 4 },
      { kind: 'UNLOCK TABLES', count: 4 },
    ]);
    expect(skippedText(importSql(fixture('postgres.sql')).skipped)).toBe(
      '28 statements skipped: 11 SET, 5 ALTER TABLE, 3 ALTER SEQUENCE, 2 CREATE SEQUENCE, 1 SELECT, 1 ALTER SCHEMA, 1 ALTER TYPE, 1 CREATE FUNCTION, 1 ALTER FUNCTION, 1 CREATE VIEW, 1 CREATE TRIGGER',
    );
    expect(skippedText(importSql(fixture('sqlserver.sql')).skipped)).toBe('15 statements skipped: 8 SET, 4 ALTER TABLE, 2 USE, 1 ALTER DATABASE');
  });

  it('keeps an asked-for dialect over the detected one', () => {
    expect(importSql(fixture('postgres.sql'), 'duckdb').dialect).toBe('duckdb');
    expect(importSql('CREATE TABLE t (id int);').dialect).toBe('postgres');
  });
});

describe('skippedText', () => {
  it('says nothing when nothing was skipped', () => {
    expect(skippedText([])).toBe('');
  });

  it('counts in the singular and the plural', () => {
    expect(skippedText([{ kind: 'INSERT', count: 1 }])).toBe('1 statement skipped: 1 INSERT');
    expect(skippedText([{ kind: 'INSERT', count: 8 }, { kind: 'CREATE VIEW', count: 4 }])).toBe('12 statements skipped: 8 INSERT, 4 CREATE VIEW');
  });

  it('counts every other statement kind', () => {
    const sql = "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);\nCREATE OR REPLACE VIEW v AS SELECT 1;\nGRANT SELECT ON t TO bob;\nCREATE MATERIALIZED VIEW m AS SELECT 1;\nCREATE TABLE copy AS SELECT * FROM t;";
    expect(skippedText(importSql(sql, 'postgres').skipped)).toBe('6 statements skipped: 2 INSERT, 1 CREATE VIEW, 1 GRANT, 1 CREATE MATERIALIZED VIEW, 1 CREATE TABLE AS');
  });
});

describe('importSql columns', () => {
  it('keeps types as written, multi-word ones too', () => {
    const t = table('CREATE TABLE t (a timestamp(6) with time zone, b character varying(255), c double precision, d numeric(10, 2), e int[], f public.mood, g "char");');
    expect(t.columns.map((c) => c.type)).toEqual(['timestamp(6) with time zone', 'character varying(255)', 'double precision', 'numeric(10, 2)', 'int[]', 'mood', 'char']);
  });

  it('reads serial types as integers that increment', () => {
    const t = table('CREATE TABLE t (a serial, b bigserial PRIMARY KEY, c smallserial);');
    expect(t.columns.map((c) => [c.type, c.increment])).toEqual([
      ['integer', true],
      ['bigint', true],
      ['smallint', true],
    ]);
  });

  it('reads each way of incrementing', () => {
    expect(table('CREATE TABLE t (a int GENERATED BY DEFAULT AS IDENTITY (START WITH 10), b int GENERATED ALWAYS AS IDENTITY);').columns.map((c) => c.increment)).toEqual([true, true]);
    expect(table('CREATE TABLE t (a int IDENTITY(1,1) NOT NULL)', 'sqlserver').columns[0]!.increment).toBe(true);
    expect(table('CREATE TABLE t (a int AUTO_INCREMENT PRIMARY KEY)', 'mysql').columns[0]!.increment).toBe(true);
    expect(table('CREATE TABLE t (a INTEGER PRIMARY KEY AUTOINCREMENT)', 'sqlite').columns[0]).toMatchObject({ pk: true, increment: true });
    const seq = table("CREATE TABLE t (a int DEFAULT nextval('t_a_seq'::regclass) NOT NULL);").columns[0]!;
    expect(seq).toMatchObject({ increment: true, notNull: true });
    expect(seq).not.toHaveProperty('default');
  });

  it('reads defaults of every kind', () => {
    const t = table("CREATE TABLE t (a int DEFAULT -1, b text DEFAULT 'it''s', c bool DEFAULT FALSE, d text DEFAULT NULL, e timestamptz DEFAULT now(), f text DEFAULT 'x'::text, g int DEFAULT (0));");
    expect(t.columns.map((c) => c.default)).toEqual([
      { kind: 'number', value: '-1' },
      { kind: 'string', value: "it's" },
      { kind: 'boolean', value: 'false' },
      { kind: 'null', value: 'null' },
      { kind: 'expression', value: 'now()' },
      { kind: 'string', value: 'x' },
      { kind: 'number', value: '0' },
    ]);
    expect(table("CREATE TABLE t ([a] [int] DEFAULT ((0)), [b] [nvarchar](5) DEFAULT (N'new'))", 'sqlserver').columns.map((c) => c.default)).toEqual([
      { kind: 'number', value: '0' },
      { kind: 'string', value: 'new' },
    ]);
  });

  it('reads not null, an explicit null, unique, checks and comments', () => {
    const t = table("CREATE TABLE `t` (`a` int NOT NULL UNIQUE CHECK (`a` > 0) COMMENT 'The a', `b` int NULL) COMMENT='The table';", 'mysql');
    expect(withoutRanges(t.columns)).toEqual([
      { name: 'a', type: 'int', pk: false, unique: true, notNull: true, increment: false, checks: ['a > 0'], note: 'The a', properties: {} },
      { name: 'b', type: 'int', pk: false, unique: false, notNull: false, increment: false, checks: [], properties: {} },
    ]);
    expect(t.note).toBe('The table');
  });

  it('warns about a clause it does not know on a column, naming the table and column, and reads the rest', () => {
    const r = importSql('CREATE TABLE orders (\n  id int PRIMARY KEY,\n  total numeric COMPRESSION lz4 NOT NULL,\n  note text\n);', 'postgres');
    expect(r.warnings).toEqual([{ message: 'Skipped an unrecognised clause on column "total" of table "orders": COMPRESSION lz4', line: 3 }]);
    expect(r.schema.tables[0]!.columns.map((c) => [c.name, c.notNull])).toEqual([
      ['id', undefined],
      ['total', true],
      ['note', undefined],
    ]);
  });

  it('warns about a table line it does not know and a computed column', () => {
    const r = importSql('CREATE TABLE t (\n  a int,\n  EXCLUDE USING gist (a WITH =)\n)', 'postgres');
    expect(r.warnings).toEqual([{ message: 'Skipped an unrecognised line in table "t": EXCLUDE USING gist (a WITH =)', line: 3 }]);
    const computed = importSql('CREATE TABLE [t] (\n  [a] [int] NOT NULL,\n  [b] AS ([a] * 2) PERSISTED\n)', 'sqlserver');
    expect(computed.warnings).toEqual([{ message: 'Left out column "b" of table "t": it is computed, and DBML has no computed columns', line: 3 }]);
    expect(computed.schema.tables[0]!.columns.map((c) => c.name)).toEqual(['a']);
  });
});

describe('importSql keys and refs', () => {
  it('makes one-column keys column settings and composite keys indexes', () => {
    const t = table('CREATE TABLE t (a int, b int, c int, CONSTRAINT t_pk PRIMARY KEY (a, b), UNIQUE (c), CONSTRAINT t_bc UNIQUE (b, c));');
    expect(t.columns.map((c) => [c.name, c.pk, c.unique])).toEqual([
      ['a', false, false],
      ['b', false, false],
      ['c', false, true],
    ]);
    expect(t.indexes).toEqual([
      { parts: [{ kind: 'column', value: 'a' }, { kind: 'column', value: 'b' }], pk: true, unique: false, name: 't_pk' },
      { parts: [{ kind: 'column', value: 'b' }, { kind: 'column', value: 'c' }], pk: false, unique: true, name: 't_bc' },
    ]);
  });

  it('reads CREATE INDEX with columns, expressions and a method', () => {
    const r = importSql('CREATE TABLE t (a text, b int);\nCREATE UNIQUE INDEX IF NOT EXISTS t_a ON t USING hash (lower(a), b DESC);', 'postgres');
    expect(r.schema.tables[0]!.indexes).toEqual([{ parts: [{ kind: 'expression', value: 'lower(a)' }, { kind: 'column', value: 'b' }], pk: false, unique: true, name: 't_a', type: 'hash' }]);
  });

  it('reads inline and table refs, with actions, and one-to-one when the column is unique', () => {
    const sql = `CREATE TABLE users (id int PRIMARY KEY);
CREATE TABLE profiles (user_id int UNIQUE REFERENCES users ON DELETE CASCADE ON UPDATE SET NULL);
CREATE TABLE posts (id int, author int, CONSTRAINT posts_author_fk FOREIGN KEY (author) REFERENCES users (id) ON DELETE SET DEFAULT ON UPDATE NO ACTION);`;
    const { schema, warnings } = importSql(sql, 'postgres');
    expect(warnings).toEqual([]);
    expect(schema.refs).toEqual([
      { from: { schema: 'public', table: 'profiles', columns: ['user_id'] }, to: { schema: 'public', table: 'users', columns: ['id'] }, op: '-', fromOptional: false, toOptional: false, inactive: false, inline: false, delete: 'cascade', update: 'set null' },
      {
        name: 'posts_author_fk',
        from: { schema: 'public', table: 'posts', columns: ['author'] },
        to: { schema: 'public', table: 'users', columns: ['id'] },
        op: '>',
        fromOptional: false,
        toOptional: false,
        inactive: false,
        inline: false,
        delete: 'set default',
        update: 'no action',
      },
    ]);
  });

  it('reads keys and table options that phpMyAdmin adds with ALTER TABLE', () => {
    const sql = `CREATE TABLE \`users\` (\`id\` int(11) NOT NULL, \`email\` varchar(191) NOT NULL) ENGINE=InnoDB;
CREATE TABLE \`posts\` (\`id\` int(11) NOT NULL, \`user_id\` int(11) DEFAULT NULL, KEY \`posts_user\` USING BTREE (\`user_id\`), FULLTEXT KEY \`ft\` (\`id\`));
ALTER TABLE \`users\` ADD PRIMARY KEY (\`id\`), ADD UNIQUE KEY \`email\` (\`email\`(50));
ALTER TABLE \`users\` MODIFY \`id\` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5, COMMENT 'People';
ALTER TABLE \`posts\` ENGINE=MyISAM;`;
    const r = importSql(sql, 'mysql');
    expect(r.warnings).toEqual([]);
    expect(r.skipped).toEqual([{ kind: 'ALTER TABLE', count: 1 }]);
    const [users, posts] = r.schema.tables;
    expect(users!.columns.map((c) => [c.name, c.pk, c.unique, c.increment])).toEqual([
      ['id', true, false, true],
      ['email', false, true, false],
    ]);
    expect(users!.note).toBe('People');
    expect(posts!.indexes.map((ix) => [ix.name, ix.type, ix.parts[0]!.value])).toEqual([
      ['posts_user', 'btree', 'user_id'],
      ['ft', 'fulltext', 'id'],
    ]);
  });

  it('reads composite foreign keys', () => {
    const sql = 'CREATE TABLE a (x int, y int, PRIMARY KEY (x, y));\nCREATE TABLE b (x int, y int, FOREIGN KEY (x, y) REFERENCES a);';
    expect(importSql(sql, 'postgres').schema.refs[0]).toMatchObject({ from: { table: 'b', columns: ['x', 'y'] }, to: { table: 'a', columns: ['x', 'y'] }, op: '>' });
  });

  it('leaves out a ref to a table that is not in the script, with a warning', () => {
    const r = importSql('CREATE TABLE orders (customer_id int REFERENCES customers (id));', 'postgres');
    expect(r.schema.refs).toEqual([]);
    expect(r.warnings).toEqual([{ message: 'Left out a foreign key from table "orders" to "customers": there is no table "customers"', line: 1 }]);
  });

  it('warns about an ALTER TABLE on a table that is not in the script', () => {
    expect(importSql('ALTER TABLE ONLY public.ghosts ADD CONSTRAINT ghosts_pkey PRIMARY KEY (id);', 'postgres').warnings).toEqual([
      { message: 'Skipped ALTER TABLE: there is no table "public.ghosts" before it', line: 1 },
    ]);
  });
});

describe('importSql schemas, enums and notes', () => {
  it("maps each dialect's default schema to public and keeps the others", () => {
    const names = (sql: string, dialect: Parameters<typeof importSql>[1]) => importSql(sql, dialect).schema.tables.map((t) => [t.schema, t.name]);
    expect(names('CREATE TABLE public.a (x int); CREATE TABLE sales.b (x int);', 'postgres')).toEqual([
      ['public', 'a'],
      ['sales', 'b'],
    ]);
    expect(names('CREATE TABLE [dbo].[a] ([x] int)\nGO\nCREATE TABLE [shop].[sales].[b] ([x] int)', 'sqlserver')).toEqual([
      ['public', 'a'],
      ['sales', 'b'],
    ]);
    expect(names('CREATE TABLE `shop`.`a` (`x` int);', 'mysql')).toEqual([['public', 'a']]);
    expect(names('CREATE TABLE main.a (x int);', 'sqlite')).toEqual([['public', 'a']]);
    expect(names('CREATE TABLE main.a (x int); CREATE TABLE lake.b (x int);', 'duckdb')).toEqual([
      ['public', 'a'],
      ['lake', 'b'],
    ]);
  });

  it('reads enums in their schema', () => {
    const { schema } = importSql("CREATE TYPE v2.status AS ENUM ('new', 'done');\nCREATE TABLE v2.jobs (s v2.status);", 'postgres');
    expect(withoutRanges(schema.enums)).toEqual([{ schema: 'v2', name: 'status', values: [{ name: 'new' }, { name: 'done' }] }]);
    expect(findTable(schema, { schema: 'v2', name: 'jobs' })!.columns[0]!.type).toBe('v2.status');
  });

  it('reads comments on tables and columns', () => {
    const { schema } = importSql("CREATE TABLE t (a int);\nCOMMENT ON TABLE t IS 'Things';\nCOMMENT ON COLUMN t.a IS 'The a';\nCOMMENT ON EXTENSION x IS 'skipped';", 'postgres');
    expect([schema.tables[0]!.note, schema.tables[0]!.columns[0]!.note]).toEqual(['Things', 'The a']);
  });
});
