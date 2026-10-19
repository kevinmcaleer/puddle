-- SQL Server script made by Puddle from the project's DBML

CREATE SCHEMA [billing];
GO

-- One per paying customer
CREATE TABLE [billing].[accounts] (
  [id] uniqueidentifier PRIMARY KEY,
  [plan] nvarchar(4) DEFAULT 'free' NOT NULL CHECK ([plan] IN ('free', 'pro')),
  [active] bit DEFAULT 1,
  [settings] nvarchar(max),
  [location] geometry,
  [opened] date -- When the account was opened
);

CREATE TABLE [authors] (
  [id] bigint IDENTITY(1,1) PRIMARY KEY,
  [name] nvarchar(80) NOT NULL,
  [account_id] uniqueidentifier
);

CREATE TABLE [books] (
  [id] bigint IDENTITY(1,1) PRIMARY KEY,
  [title] nvarchar(max) NOT NULL,
  [price] decimal(8,2) CHECK (price > 0),
  [added] datetimeoffset DEFAULT (now())
);

CREATE TABLE [books_authors] (
  [books_id] bigint NOT NULL,
  [authors_id] bigint NOT NULL,
  PRIMARY KEY ([books_id], [authors_id])
);

ALTER TABLE [authors] ADD FOREIGN KEY ([account_id]) REFERENCES [billing].[accounts] ([id]) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE [books_authors] ADD FOREIGN KEY ([books_id]) REFERENCES [books] ([id]);
ALTER TABLE [books_authors] ADD FOREIGN KEY ([authors_id]) REFERENCES [authors] ([id]);

INSERT INTO [authors] ([id], [name]) VALUES
  (1, 'Ursula'),
  (2, 'Terry');
