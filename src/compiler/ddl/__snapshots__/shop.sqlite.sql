-- SQLite script made by Puddle from the project's DBML

-- Everyone who has signed up
CREATE TABLE "customers" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "email" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "country" text DEFAULT 'GB',
  "created_at" text DEFAULT (now())
);

CREATE TABLE "orders" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "customer_id" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'paid', 'shipped', 'cancelled')),
  "total" numeric NOT NULL CHECK (total >= 0),
  "ordered_at" text NOT NULL,
  FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")
);

CREATE INDEX "orders_by_customer" ON "orders" ("customer_id", "ordered_at");

CREATE TABLE "products" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "sku" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "price" numeric NOT NULL
);

CREATE TABLE "order_items" (
  "order_id" integer NOT NULL,
  "product_id" integer NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  PRIMARY KEY ("order_id", "product_id"),
  FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("product_id") REFERENCES "products" ("id")
);
