-- The shop, as the LibSQL tests seed a Turso-shaped server (sqld in CI, scripts/libsql-stand-in.mjs locally): the
-- same rows as shop.sqlite, with what SQLite can declare (AUTOINCREMENT, UNIQUE, a default, a foreign key, an index,
-- a view). One statement per line.
DROP VIEW IF EXISTS order_totals;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE, signed_up DATE, active BOOLEAN DEFAULT 1);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total DECIMAL(10,2), placed_at DATETIME, status TEXT DEFAULT 'placed', notes TEXT, tags TEXT);
CREATE INDEX orders_customer ON orders (customer_id);
CREATE VIEW order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
INSERT INTO customers (id, name, email, signed_up, active) VALUES (1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', 1), (2, 'Grace Hopper', 'grace@example.com', '2024-02-20', 1), (3, 'Alan Turing', NULL, '2024-03-05', 0);
INSERT INTO orders (id, customer_id, total, placed_at, status, notes, tags) VALUES (101, 1, 19.99, '2024-04-01 09:30:00', 'shipped', 'Gift wrap', '["gift","express"]'), (102, 1, 5.5, '2024-04-02 14:00:00', 'placed', NULL, '[]'), (103, 2, 120, '2024-04-03 11:15:00', 'returned', NULL, '["bulk"]'), (104, 3, 42.25, '2024-04-04 16:45:00', 'placed', NULL, '[]');
