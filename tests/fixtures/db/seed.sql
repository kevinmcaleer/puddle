-- The shop, as the PostgreSQL family tests seed it (CI job "databases", and a local server for the Playwright flow):
-- the same rows as shop.sqlite, with the things those databases can say about themselves (an enum, comments, a
-- serial key, a unique email, an index, a view).
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TYPE IF EXISTS order_status;
CREATE TYPE order_status AS ENUM ('placed', 'shipped', 'returned');
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  signed_up DATE,
  active BOOLEAN DEFAULT true
);
COMMENT ON TABLE customers IS 'People who have ordered';
COMMENT ON COLUMN customers.email IS 'Lower case';
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  total NUMERIC(10, 2),
  placed_at TIMESTAMP,
  status order_status NOT NULL DEFAULT 'placed'
);
CREATE INDEX orders_customer ON orders (customer_id);
CREATE OR REPLACE VIEW order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
INSERT INTO customers (id, name, email, signed_up, active) VALUES
  (1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', true),
  (2, 'Grace Hopper', 'grace@example.com', '2024-02-20', true),
  (3, 'Alan Turing', NULL, '2024-03-05', false);
INSERT INTO orders (id, customer_id, total, placed_at, status) VALUES
  (101, 1, 19.99, '2024-04-01 09:30:00', 'shipped'),
  (102, 1, 5.5, '2024-04-02 14:00:00', 'placed'),
  (103, 2, 120, '2024-04-03 11:15:00', 'returned'),
  (104, 3, 42.25, '2024-04-04 16:45:00', 'placed');
