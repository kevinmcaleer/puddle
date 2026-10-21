-- The shop, as the SQL Server tests seed it (the SQL Server container in CI): the same rows as shop.sqlite, with
-- what SQL Server can say about itself (identity keys, extended properties as comments, a unique email, an index,
-- datetime2 and money columns, a view). Batches are separated by GO lines, as scripts/seed-sqlserver.mjs runs them.
IF OBJECT_ID('dbo.order_totals', 'V') IS NOT NULL DROP VIEW dbo.order_totals;
IF OBJECT_ID('dbo.orders', 'U') IS NOT NULL DROP TABLE dbo.orders;
IF OBJECT_ID('dbo.customers', 'U') IS NOT NULL DROP TABLE dbo.customers;
GO
CREATE TABLE customers (
  id int IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  name nvarchar(100) NOT NULL,
  email nvarchar(255) NULL UNIQUE,
  signed_up date NULL,
  active bit NOT NULL DEFAULT 1
);
EXEC sp_addextendedproperty 'MS_Description', 'People who have ordered', 'SCHEMA', 'dbo', 'TABLE', 'customers';
EXEC sp_addextendedproperty 'MS_Description', 'Lower case', 'SCHEMA', 'dbo', 'TABLE', 'customers', 'COLUMN', 'email';
CREATE TABLE orders (
  id int IDENTITY(1, 1) NOT NULL PRIMARY KEY,
  customer_id int NOT NULL,
  total decimal(10, 2) NULL,
  placed_at datetime2 NULL,
  status varchar(10) NOT NULL DEFAULT 'placed',
  paid money NULL,
  CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers (id)
);
CREATE INDEX orders_customer ON orders (customer_id);
GO
CREATE VIEW order_totals AS SELECT c.name, count(o.id) AS orders, sum(o.total) AS total FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
GO
SET IDENTITY_INSERT customers ON;
INSERT INTO customers (id, name, email, signed_up, active) VALUES
  (1, 'Ada Lovelace', 'ada@example.com', '2024-01-15', 1),
  (2, 'Grace Hopper', 'grace@example.com', '2024-02-20', 1),
  (3, 'Alan Turing', NULL, '2024-03-05', 0);
SET IDENTITY_INSERT customers OFF;
SET IDENTITY_INSERT orders ON;
INSERT INTO orders (id, customer_id, total, placed_at, status, paid) VALUES
  (101, 1, 19.99, '2024-04-01 09:30:00', 'shipped', 19.99),
  (102, 1, 5.5, '2024-04-02 14:00:00', 'placed', NULL),
  (103, 2, 120, '2024-04-03 11:15:00', 'returned', 120),
  (104, 3, 42.25, '2024-04-04 16:45:00', 'placed', NULL);
SET IDENTITY_INSERT orders OFF;
GO
