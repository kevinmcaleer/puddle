-- The shop in BigQuery, for a real project to prove the driver against (run it in the console or with bq query
-- --use_legacy_sql=false; scripts/bigquery-stand-in.mjs serves the same shop without a project). Keys are kept
-- unenforced, as BigQuery keeps them.
CREATE SCHEMA IF NOT EXISTS shop;

CREATE OR REPLACE TABLE shop.customers (
  id INT64 NOT NULL,
  name STRING NOT NULL,
  email STRING OPTIONS (description = 'Lower case'),
  signed_up DATE,
  active BOOL,
  PRIMARY KEY (id) NOT ENFORCED
) OPTIONS (description = 'People who have ordered');

CREATE OR REPLACE TABLE shop.orders (
  id INT64 NOT NULL,
  customer_id INT64 NOT NULL,
  total NUMERIC,
  placed_at TIMESTAMP,
  status STRING DEFAULT 'placed',
  notes STRING,
  tags ARRAY<STRING>,
  shipping STRUCT<city STRING, postcode STRING>,
  PRIMARY KEY (id) NOT ENFORCED,
  FOREIGN KEY (customer_id) REFERENCES shop.customers (id) NOT ENFORCED
);

INSERT INTO shop.customers (id, name, email, signed_up, active) VALUES
  (1, 'Ada Lovelace', 'ada@example.com', DATE '2024-01-15', TRUE),
  (2, 'Grace Hopper', 'grace@example.com', DATE '2024-02-20', TRUE),
  (3, 'Alan Turing', NULL, DATE '2024-03-05', FALSE);

INSERT INTO shop.orders (id, customer_id, total, placed_at, status, notes, tags, shipping) VALUES
  (101, 1, NUMERIC '19.99', TIMESTAMP '2024-04-01 09:30:00 UTC', 'shipped', 'Gift wrap', ['gift', 'express'], STRUCT('London', 'N1 9GU')),
  (102, 1, NUMERIC '5.50', TIMESTAMP '2024-04-02 14:00:00 UTC', 'placed', NULL, [], NULL),
  (103, 2, NUMERIC '120.00', TIMESTAMP '2024-04-03 11:15:00 UTC', 'returned', NULL, ['bulk'], STRUCT('Leeds', 'LS1 1UR')),
  (104, 3, NUMERIC '42.25', TIMESTAMP '2024-04-04 16:45:00 UTC', 'placed', NULL, [], NULL);

CREATE OR REPLACE VIEW shop.order_totals AS
  SELECT c.name, COUNT(o.id) AS orders, SUM(o.total) AS total
  FROM shop.orders o JOIN shop.customers c ON c.id = o.customer_id
  GROUP BY c.name;
