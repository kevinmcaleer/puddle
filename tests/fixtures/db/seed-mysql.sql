-- The shop, as the MySQL family tests seed it (MySQL, MariaDB and TiDB containers in CI, a local server for the
-- Playwright flow): the same rows as shop.sqlite, with what those databases can say about themselves (an ENUM
-- column, comments, an auto-increment key, a unique email, an index, a view).
DROP VIEW IF EXISTS order_totals;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE COMMENT 'Lower case',
  signed_up DATE,
  active BOOLEAN DEFAULT TRUE
) COMMENT = 'People who have ordered';
CREATE TABLE orders (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  total DECIMAL(10, 2),
  placed_at DATETIME,
  status ENUM('placed', 'shipped', 'returned') NOT NULL DEFAULT 'placed',
  CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers (id),
  INDEX orders_customer (customer_id)
);
CREATE VIEW order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
INSERT INTO customers (id, name, email, signed_up, active) VALUES
  (1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', TRUE),
  (2, 'Grace Hopper', 'grace@example.com', '2024-02-20', TRUE),
  (3, 'Alan Turing', NULL, '2024-03-05', FALSE);
INSERT INTO orders (id, customer_id, total, placed_at, status) VALUES
  (101, 1, 19.99, '2024-04-01 09:30:00', 'shipped'),
  (102, 1, 5.5, '2024-04-02 14:00:00', 'placed'),
  (103, 2, 120, '2024-04-03 11:15:00', 'returned'),
  (104, 3, 42.25, '2024-04-04 16:45:00', 'placed');
