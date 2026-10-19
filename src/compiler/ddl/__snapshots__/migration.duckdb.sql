-- DuckDB migration made by Puddle from the saved version to the project's DBML

-- By hand: DuckDB can’t drop the foreign key from orders to products in place: rebuild orders without it.
DROP INDEX "reviews_index_1";

-- Loses data: drops table audit_log
DROP TABLE "audit_log";

-- By hand: DuckDB can’t add the value 'refunded' to enum order_status: make a new type with the values and change the columns that use it.

ALTER TABLE "vendors" RENAME TO "suppliers";
ALTER TABLE "reviews" RENAME COLUMN "body" TO "comment";

ALTER TABLE "customers" ADD COLUMN "referrer_id" integer;
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp;

-- By hand: DuckDB can’t make customers.name not null while foreign keys from orders point at customers: rebuild those tables without them first.
ALTER TABLE "customers" ALTER COLUMN "country" SET DEFAULT 'US';
-- By hand: DuckDB can’t make products.price nullable while foreign keys from orders, reviews point at products: rebuild those tables without them first.
ALTER TABLE "orders" ALTER COLUMN "total" TYPE decimal(12,2);
ALTER TABLE "orders" ALTER COLUMN "total" SET NOT NULL;

-- Loses data: drops column orders.legacy_code
ALTER TABLE "orders" DROP COLUMN "legacy_code";

CREATE SEQUENCE IF NOT EXISTS "refunds_id_seq";
CREATE TABLE "refunds" (
  "id" integer DEFAULT nextval('"refunds_id_seq"') PRIMARY KEY,
  "order_id" integer NOT NULL,
  "supplier_id" integer,
  "amount" decimal(10,2) NOT NULL,
  FOREIGN KEY ("order_id") REFERENCES "orders" ("id"),
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id")
);
CREATE INDEX "refunds_index_1" ON "refunds" ("order_id");

CREATE INDEX "orders_index_1" ON "orders" ("customer_id", "status");
CREATE INDEX "reviews_index_1" ON "reviews" ("product_id");
-- By hand: DuckDB can’t add a foreign key to an existing table: rebuild customers with FOREIGN KEY ("referrer_id") REFERENCES "customers" ("id").
