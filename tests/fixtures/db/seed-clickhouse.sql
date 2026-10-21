-- The shop, as the ClickHouse tests seed it (a ClickHouse container in CI, the chdb stand-in locally): the same rows
-- as shop.sqlite, with what ClickHouse can say about itself (a sorting key, comments, a Nullable column, a
-- LowCardinality one, a Decimal, a DateTime, an Array, a skipping index, a view). One statement per block.
DROP VIEW IF EXISTS order_totals;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id UInt32,
  name String,
  email Nullable(String) COMMENT 'Lower case',
  signed_up Nullable(Date),
  active Bool DEFAULT true
) ENGINE = MergeTree ORDER BY id COMMENT 'People who have ordered';
CREATE TABLE orders (
  id UInt32,
  customer_id UInt32,
  total Decimal(10, 2),
  placed_at DateTime,
  status LowCardinality(String) DEFAULT 'placed',
  notes Nullable(String),
  tags Array(String),
  INDEX orders_status status TYPE set(10) GRANULARITY 1
) ENGINE = MergeTree ORDER BY (customer_id, id);
CREATE VIEW order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
INSERT INTO customers (id, name, email, signed_up, active) VALUES (1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', true), (2, 'Grace Hopper', 'grace@example.com', '2024-02-20', true), (3, 'Alan Turing', NULL, '2024-03-05', false);
INSERT INTO orders (id, customer_id, total, placed_at, status, notes, tags) VALUES (101, 1, 19.99, '2024-04-01 09:30:00', 'shipped', 'Gift wrap', ['gift', 'express']), (102, 1, 5.5, '2024-04-02 14:00:00', 'placed', NULL, []), (103, 2, 120, '2024-04-03 11:15:00', 'returned', NULL, ['bulk']), (104, 3, 42.25, '2024-04-04 16:45:00', 'placed', NULL, []);
