-- SQLite script made by Puddle from the project's DBML

-- One per paying customer
CREATE TABLE "accounts" (
  "id" text PRIMARY KEY,
  "plan" text DEFAULT 'free' NOT NULL CHECK ("plan" IN ('free', 'pro')),
  "active" integer DEFAULT 1,
  "settings" text,
  "location" geometry,
  "opened" text -- When the account was opened
);

CREATE TABLE "authors" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "name" text NOT NULL,
  "account_id" text,
  FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE RESTRICT
);

CREATE TABLE "books" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "title" text NOT NULL,
  "price" numeric CHECK (price > 0),
  "added" text DEFAULT (now())
);

CREATE TABLE "books_authors" (
  "books_id" integer NOT NULL,
  "authors_id" integer NOT NULL,
  PRIMARY KEY ("books_id", "authors_id"),
  FOREIGN KEY ("books_id") REFERENCES "books" ("id"),
  FOREIGN KEY ("authors_id") REFERENCES "authors" ("id")
);

INSERT INTO "authors" ("id", "name") VALUES
  (1, 'Ursula'),
  (2, 'Terry');
