-- DuckDB script made by Puddle from the project's DBML

CREATE SCHEMA IF NOT EXISTS "billing";

CREATE TYPE "billing"."plan" AS ENUM ('free', 'pro');

-- One per paying customer
CREATE TABLE "billing"."accounts" (
  "id" uuid PRIMARY KEY,
  "plan" "billing"."plan" DEFAULT 'free' NOT NULL,
  "active" boolean DEFAULT true,
  "settings" varchar,
  "location" geometry,
  "opened" date -- When the account was opened
);

CREATE SEQUENCE IF NOT EXISTS "authors_id_seq";
CREATE TABLE "authors" (
  "id" bigint DEFAULT nextval('"authors_id_seq"') PRIMARY KEY,
  "name" varchar NOT NULL,
  "account_id" uuid
);

CREATE SEQUENCE IF NOT EXISTS "books_id_seq";
CREATE TABLE "books" (
  "id" bigint DEFAULT nextval('"books_id_seq"') PRIMARY KEY,
  "title" varchar NOT NULL,
  "price" decimal(8,2) CHECK (price > 0),
  "added" timestamptz DEFAULT (now())
);

CREATE TABLE "books_authors" (
  "books_id" bigint NOT NULL,
  "authors_id" bigint NOT NULL,
  PRIMARY KEY ("books_id", "authors_id"),
  FOREIGN KEY ("books_id") REFERENCES "books" ("id"),
  FOREIGN KEY ("authors_id") REFERENCES "authors" ("id")
);

INSERT INTO "authors" ("id", "name") VALUES
  (1, 'Ursula'),
  (2, 'Terry');
