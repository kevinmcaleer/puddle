-- The shop in Snowflake, for a real account to prove the driver against (run it in a worksheet as a role that can
-- create in the database; scripts/snowflake-stand-in.mjs serves the same shop without an account). Unquoted names
-- are upper case in Snowflake, so the tables are CUSTOMERS, ORDERS and ORDER_TOTALS. Give the Puddle user a
-- read-only role on SHOP: Snowflake has no read-only session.
CREATE DATABASE IF NOT EXISTS shop;
USE DATABASE shop;
USE SCHEMA public;

CREATE OR REPLACE TABLE customers (
  id NUMBER(10,0) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE COMMENT 'Lower case',
  signed_up DATE,
  active BOOLEAN
) COMMENT = 'People who have ordered';

CREATE OR REPLACE TABLE orders (
  id NUMBER(10,0) NOT NULL IDENTITY PRIMARY KEY,
  customer_id NUMBER(10,0) NOT NULL REFERENCES customers (id),
  total NUMBER(10,2),
  placed_at TIMESTAMP_NTZ,
  delivered_at TIMESTAMP_TZ,
  status VARCHAR(10) DEFAULT 'placed',
  notes VARCHAR,
  tags ARRAY,
  shipping OBJECT
);

INSERT INTO customers (id, name, email, signed_up, active) VALUES
  (1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', TRUE),
  (2, 'Grace Hopper', 'grace@example.com', '2024-02-20', TRUE),
  (3, 'Alan Turing', NULL, '2024-03-05', FALSE);

INSERT INTO orders (id, customer_id, total, placed_at, delivered_at, status, notes, tags, shipping)
  SELECT 101, 1, 19.99, '2024-04-01 09:30:00', '2024-04-02 09:00:00 +01:00', 'shipped', 'Gift wrap', ARRAY_CONSTRUCT('gift', 'express'), OBJECT_CONSTRUCT('city', 'London', 'postcode', 'N1 9GU')
  UNION ALL SELECT 102, 1, 5.50, '2024-04-02 14:00:00', NULL, 'placed', NULL, ARRAY_CONSTRUCT(), NULL
  UNION ALL SELECT 103, 2, 120.00, '2024-04-03 11:15:00', NULL, 'returned', NULL, ARRAY_CONSTRUCT('bulk'), OBJECT_CONSTRUCT('city', 'Leeds', 'postcode', 'LS1 1UR')
  UNION ALL SELECT 104, 3, 42.25, '2024-04-04 16:45:00', NULL, 'placed', NULL, ARRAY_CONSTRUCT(), NULL;

CREATE OR REPLACE VIEW order_totals AS
  SELECT c.name, COUNT(o.id) AS orders, SUM(o.total) AS total
  FROM orders o JOIN customers c ON c.id = o.customer_id
  GROUP BY c.name;
