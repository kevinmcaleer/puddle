// Sample rows on real DuckDB-WASM (Node build): rows generated for every table, written into the DBML as records and
// built as the DuckDB build does, load without breaking a key, check, enum or foreign key.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dropDuckdbSchema, schemaDdl } from '../../src/compiler/ddl/duckdb';
import { EngineClient, tableRows } from '../../src/engine/client';
import { parseDbml, type DbmlSchema } from '../../src/schema';
import { addRecords, generateRows, recordsBlock } from '../../src/schema/sample';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => readFileSync(join(__dirname, `../fixtures/dbml/${name}.dbml`), 'utf8');

// Another schema, a composite key and ref, unique columns, a one-to-one and a self ref, simple checks, an enum value
// that needs quotes, existing records to point at, and most column types.
const MORE = `Enum v2.state {
  open
  "on hold"
}

Table v2.merchants {
  id int
  country_code char(2)
  state v2.state [not null]
  rating decimal(3,1) [check: \`rating between 0 and 5\`]
  indexes {
    (id, country_code) [pk]
  }
}

Table v2.periods {
  merchant_id int [not null]
  country_code char(2) [not null]
  starts date [not null]
  ends date
  size varchar(1) [not null, check: \`size in ('S', 'M', 'L')\`]
}

Ref: v2.periods.(merchant_id, country_code) > v2.merchants.(id, country_code)

Table v2.accounts {
  id bigint [pk, increment]
  handle varchar(8) [unique, not null]
  merchant_id int
  merchant_country char(2)
  manager_id bigint [ref: > v2.accounts.id]
  opened timestamptz [not null]
  token uuid [unique]
  settings json
  active boolean [not null, default: true]
  wake time
  level smallint [not null, check: \`level > 0\`, check: \`level < 4\`]
  tags varchar[]
  owner_id int [not null, ref: > v2.owners.id]
  created_at timestamp [default: \`now()\`]
}

Ref: v2.accounts.(merchant_id, merchant_country) > v2.merchants.(id, country_code)

Table v2.profiles {
  account_id bigint [pk, ref: - v2.accounts.id]
  bio text
}

Table v2.owners {
  id int [pk]
  name varchar [not null]
}

records v2.owners(id, name) {
  41, 'Ada'
  43, 'Grace'
}
`;

let engine: EngineClient;
const count = async (sql: string) => Number(tableRows((await engine.query(sql)).table)[0]!.n);
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

/** Rows for every table of the DBML, written in as records, parsed and built on DuckDB statement by statement. */
async function buildWithSamples(dbml: string, rows: number): Promise<DbmlSchema> {
  const before = parseDbml(dbml).schema;
  const g = generateRows(before, before.tables.filter((t) => !before.records.some((r) => r.table === t.name && r.schema === t.schema)).map((t) => `table:${t.schema}.${t.name}`), { rows, seed: 2026 });
  expect(g.notes).toEqual([]);
  const { schema, errors } = parseDbml(addRecords(dbml, g.tables.map((t) => recordsBlock(t, { example: false }))));
  expect(errors).toEqual([]);
  for (const s of new Set(schema.tables.map((t) => t.schema))) await engine.query(dropDuckdbSchema(s));
  for (const statement of schemaDdl(schema).statements) await engine.query(statement);
  return schema;
}

describe('sample rows built on DuckDB', () => {
  it('loads 100 rows into every table of the shop, every order’s customer there', async () => {
    await buildWithSamples(fixture('shop'), 100);
    for (const t of ['customers', 'orders', 'products', 'order_items']) expect(await count(`SELECT count(*) AS n FROM dbml_public.${t}`)).toBe(100);
    expect(await count('SELECT count(*) AS n FROM dbml_public.orders o ANTI JOIN dbml_public.customers c ON o.customer_id = c.id')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM dbml_public.order_items i ANTI JOIN dbml_public.orders o ON i.order_id = o.id')).toBe(0);
    // created_at was left for its default to fill.
    expect(await count('SELECT count(*) AS n FROM dbml_public.customers WHERE created_at IS NULL')).toBe(0);
  });

  it('loads composite keys and refs, unique columns, a one-to-one and a self ref in another schema', async () => {
    await buildWithSamples(MORE, 100);
    expect(await count('SELECT count(*) AS n FROM dbml_v2.merchants')).toBe(100);
    expect(await count('SELECT count(*) AS n FROM dbml_v2.periods')).toBe(100);
    expect(await count('SELECT count(*) AS n FROM dbml_v2.accounts')).toBe(100);
    expect(await count('SELECT count(*) AS n FROM dbml_v2.profiles')).toBe(100);
    expect(await count('SELECT count(*) AS n FROM dbml_v2.periods p ANTI JOIN dbml_v2.merchants m ON p.merchant_id = m.id AND p.country_code = m.country_code')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM dbml_v2.accounts a WHERE manager_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbml_v2.accounts m WHERE m.id = a.manager_id)')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM (SELECT * FROM dbml_v2.accounts WHERE merchant_id IS NOT NULL) a ANTI JOIN dbml_v2.merchants m ON a.merchant_id = m.id AND a.merchant_country = m.country_code')).toBe(0);
    // The owners' own records are the parents, and aren't generated again.
    expect(await count('SELECT count(*) AS n FROM dbml_v2.owners')).toBe(2);
    expect(await count('SELECT count(DISTINCT owner_id) AS n FROM dbml_v2.accounts WHERE owner_id IN (41, 43)')).toBe(2);
    expect(await count(`SELECT count(*) AS n FROM dbml_v2.merchants WHERE state = 'on hold'`)).toBeGreaterThan(0);
  });
});
