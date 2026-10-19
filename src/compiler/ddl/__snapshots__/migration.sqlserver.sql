-- SQL Server migration made by Puddle from the saved version to the project's DBML

-- By hand: The foreign key from orders to products has no name in the DBML: look up the name SQL Server gave it and drop it.

-- By hand: SQL Server writes enum order_status as a check on orders.status: drop those checks and add them again with the values 'pending', 'paid', 'shipped', 'refunded'.

EXEC sp_rename 'vendors', 'suppliers';
EXEC sp_rename 'reviews.body', 'comment', 'COLUMN';

ALTER TABLE [customers] ADD [referrer_id] int;
ALTER TABLE [orders] ADD [shipped_at] datetime2;

ALTER TABLE [customers] ALTER COLUMN [name] nvarchar(100) NOT NULL;
-- By hand: Look up the name SQL Server gave the default of customers.country and drop it; then run the ADD DEFAULT below.
ALTER TABLE [customers] ADD DEFAULT 'US' FOR [country];
-- Loses data: narrows products.sku from varchar(32) to varchar(16)
ALTER TABLE [products] ALTER COLUMN [sku] nvarchar(16) NOT NULL;
ALTER TABLE [products] ALTER COLUMN [price] decimal(10,2) NULL;
ALTER TABLE [orders] ALTER COLUMN [status] nvarchar(8) NOT NULL;
ALTER TABLE [orders] ALTER COLUMN [total] decimal(12,2) NOT NULL;
-- Loses data: narrows orders.note from text to varchar(500)
ALTER TABLE [orders] ALTER COLUMN [note] nvarchar(500) NULL;

-- Loses data: drops column orders.legacy_code
ALTER TABLE [orders] DROP COLUMN [legacy_code];

CREATE TABLE [refunds] (
  [id] int IDENTITY(1,1) PRIMARY KEY,
  [order_id] int NOT NULL,
  [supplier_id] int,
  [amount] decimal(10,2) NOT NULL
);
CREATE INDEX [refunds_index_1] ON [refunds] ([order_id]);

CREATE INDEX [orders_index_1] ON [orders] ([customer_id], [status]);
ALTER TABLE [refunds] ADD FOREIGN KEY ([order_id]) REFERENCES [orders] ([id]);
ALTER TABLE [refunds] ADD FOREIGN KEY ([supplier_id]) REFERENCES [suppliers] ([id]);
ALTER TABLE [customers] ADD FOREIGN KEY ([referrer_id]) REFERENCES [customers] ([id]);

-- Loses data: drops table audit_log
DROP TABLE [audit_log];
