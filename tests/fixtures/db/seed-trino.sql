-- The shop, as the Trino tests seed it into the memory connector (a Trino container in CI): the same rows as
-- shop.sqlite, with what Trino can say about itself (a comment, a decimal, a timestamp, an array, a view). One
-- statement per block, run in the memory.shop schema.
CREATE SCHEMA IF NOT EXISTS memory.shop;
DROP VIEW IF EXISTS memory.shop.order_totals;
DROP TABLE IF EXISTS memory.shop.orders;
DROP TABLE IF EXISTS memory.shop.customers;
CREATE TABLE memory.shop.customers (id integer, name varchar(100), email varchar(255), signed_up date, active boolean);
COMMENT ON TABLE memory.shop.customers IS 'People who have ordered';
COMMENT ON COLUMN memory.shop.customers.email IS 'Lower case';
CREATE TABLE memory.shop.orders (id integer, customer_id integer, total decimal(10, 2), placed_at timestamp(3), status varchar(10), notes varchar, tags array(varchar));
CREATE VIEW memory.shop.order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM memory.shop.customers c LEFT JOIN memory.shop.orders o ON o.customer_id = c.id GROUP BY c.name;
INSERT INTO memory.shop.customers VALUES (1, 'Ada Lovelace', 'ada@example.com', DATE '2024-01-15', true), (2, 'Grace Hopper', 'grace@example.com', DATE '2024-02-20', true), (3, 'Alan Turing', NULL, DATE '2024-03-05', false);
INSERT INTO memory.shop.orders VALUES (101, 1, 19.99, TIMESTAMP '2024-04-01 09:30:00', 'shipped', 'Gift wrap', ARRAY['gift', 'express']), (102, 1, 5.5, TIMESTAMP '2024-04-02 14:00:00', 'placed', NULL, ARRAY[]), (103, 2, 120, TIMESTAMP '2024-04-03 11:15:00', 'returned', NULL, ARRAY['bulk']), (104, 3, 42.25, TIMESTAMP '2024-04-04 16:45:00', 'placed', NULL, ARRAY[]);
