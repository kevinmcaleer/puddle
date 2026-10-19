-- SQL Server script made by Puddle from the project's DBML

-- Everyone who has signed up
CREATE TABLE [customers] (
  [id] int IDENTITY(1,1) PRIMARY KEY,
  [email] nvarchar(255) NOT NULL UNIQUE,
  [name] nvarchar(100) NOT NULL,
  [country] nchar(2) DEFAULT 'GB',
  [created_at] datetime2 DEFAULT (now())
);

CREATE TABLE [orders] (
  [id] int IDENTITY(1,1) PRIMARY KEY,
  [customer_id] int NOT NULL,
  [status] nvarchar(9) DEFAULT 'pending' NOT NULL CHECK ([status] IN ('pending', 'paid', 'shipped', 'cancelled')),
  [total] decimal(10,2) NOT NULL CHECK (total >= 0),
  [ordered_at] datetime2 NOT NULL
);

CREATE INDEX [orders_by_customer] ON [orders] ([customer_id], [ordered_at]);

CREATE TABLE [products] (
  [id] int IDENTITY(1,1) PRIMARY KEY,
  [sku] nvarchar(32) NOT NULL UNIQUE,
  [name] nvarchar(max) NOT NULL,
  [price] decimal(10,2) NOT NULL
);

CREATE TABLE [order_items] (
  [order_id] int NOT NULL,
  [product_id] int NOT NULL,
  [quantity] int DEFAULT 1 NOT NULL,
  PRIMARY KEY ([order_id], [product_id])
);

ALTER TABLE [orders] ADD FOREIGN KEY ([customer_id]) REFERENCES [customers] ([id]);
ALTER TABLE [order_items] ADD FOREIGN KEY ([order_id]) REFERENCES [orders] ([id]) ON DELETE CASCADE;
ALTER TABLE [order_items] ADD FOREIGN KEY ([product_id]) REFERENCES [products] ([id]);
