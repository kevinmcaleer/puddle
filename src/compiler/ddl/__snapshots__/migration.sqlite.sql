-- SQLite migration made by Puddle from the saved version to the project's DBML

-- By hand: SQLite can’t drop the foreign key from orders to products in place: rebuild orders without it.

-- By hand: SQLite writes enum order_status as a check on orders.status: rebuild those tables with the values 'pending', 'paid', 'shipped', 'refunded'.

ALTER TABLE "vendors" RENAME TO "suppliers";
ALTER TABLE "reviews" RENAME COLUMN "body" TO "comment";

ALTER TABLE "customers" ADD COLUMN "referrer_id" integer REFERENCES "customers" ("id");
ALTER TABLE "orders" ADD COLUMN "shipped_at" text;

-- By hand: SQLite can’t change customers.name in place (not null): rebuild customers — create it anew, copy the rows across, drop the old table and rename the new one.
-- By hand: SQLite can’t change customers.country in place (default): rebuild customers — create it anew, copy the rows across, drop the old table and rename the new one.
-- By hand: SQLite can’t change products.price in place (nullable): rebuild products — create it anew, copy the rows across, drop the old table and rename the new one.
-- By hand: SQLite can’t change orders.total in place (not null): rebuild orders — create it anew, copy the rows across, drop the old table and rename the new one.

-- Loses data: drops column orders.legacy_code
ALTER TABLE "orders" DROP COLUMN "legacy_code";

CREATE TABLE "refunds" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "order_id" integer NOT NULL,
  "supplier_id" integer,
  "amount" numeric NOT NULL,
  FOREIGN KEY ("order_id") REFERENCES "orders" ("id"),
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id")
);
CREATE INDEX "refunds_index_1" ON "refunds" ("order_id");

CREATE INDEX "orders_index_1" ON "orders" ("customer_id", "status");

-- Loses data: drops table audit_log
DROP TABLE "audit_log";
