-- DuckDB script made by Puddle from the project's DBML

CREATE TYPE "order_status" AS ENUM ('pending', 'paid', 'shipped', 'cancelled');

CREATE SEQUENCE IF NOT EXISTS "customers_id_seq";
-- Everyone who has signed up
CREATE TABLE "customers" (
  "id" integer DEFAULT nextval('"customers_id_seq"') PRIMARY KEY,
  "email" varchar NOT NULL UNIQUE,
  "name" varchar NOT NULL,
  "country" varchar DEFAULT 'GB',
  "created_at" timestamp DEFAULT (now())
);

CREATE SEQUENCE IF NOT EXISTS "orders_id_seq";
CREATE TABLE "orders" (
  "id" integer DEFAULT nextval('"orders_id_seq"') PRIMARY KEY,
  "customer_id" integer NOT NULL,
  "status" "order_status" DEFAULT 'pending' NOT NULL,
  "total" decimal(10,2) NOT NULL CHECK (total >= 0),
  "ordered_at" timestamp NOT NULL,
  FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")
);

CREATE INDEX "orders_by_customer" ON "orders" ("customer_id", "ordered_at");

CREATE SEQUENCE IF NOT EXISTS "products_id_seq";
CREATE TABLE "products" (
  "id" integer DEFAULT nextval('"products_id_seq"') PRIMARY KEY,
  "sku" varchar NOT NULL UNIQUE,
  "name" varchar NOT NULL,
  "price" decimal(10,2) NOT NULL
);

CREATE TABLE "order_items" (
  "order_id" integer NOT NULL,
  "product_id" integer NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  PRIMARY KEY ("order_id", "product_id"),
  FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE NO ACTION,
  FOREIGN KEY ("product_id") REFERENCES "products" ("id")
);
