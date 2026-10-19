USE [shop]
GO
/****** Object:  Table [dbo].[customers]    Script Date: 01/03/2024 12:00:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[customers](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[email] [nvarchar](255) NOT NULL,
	[name] [nvarchar](100) NOT NULL,
	[created_at] [datetime2](7) NOT NULL,
	[updated_at] [datetime2](7) NULL,
 CONSTRAINT [PK_customers] PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_customers_email] UNIQUE NONCLUSTERED 
(
	[email] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[products]    Script Date: 01/03/2024 12:00:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[products](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[sku] [nvarchar](32) NOT NULL,
	[name] [nvarchar](200) NOT NULL,
	[price] [decimal](10, 2) NOT NULL,
	[description] [nvarchar](max) NULL,
 CONSTRAINT [PK_products] PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
 CONSTRAINT [UQ_products_sku] UNIQUE NONCLUSTERED 
(
	[sku] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[orders]    Script Date: 01/03/2024 12:00:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[orders](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[customer_id] [int] NOT NULL,
	[status] [nvarchar](20) NOT NULL,
	[placed_at] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_orders] PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[order_items]    Script Date: 01/03/2024 12:00:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[order_items](
	[order_id] [int] NOT NULL,
	[product_id] [int] NOT NULL,
	[quantity] [int] NOT NULL,
	[unit_price] [decimal](10, 2) NOT NULL,
 CONSTRAINT [PK_order_items] PRIMARY KEY CLUSTERED 
(
	[order_id] ASC,
	[product_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Index [IX_orders_customer_id]    Script Date: 01/03/2024 12:00:00 ******/
CREATE NONCLUSTERED INDEX [IX_orders_customer_id] ON [dbo].[orders]
(
	[customer_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
GO
ALTER TABLE [dbo].[customers] ADD  DEFAULT (getdate()) FOR [created_at]
GO
ALTER TABLE [dbo].[products] ADD  CONSTRAINT [DF_products_price]  DEFAULT ((0)) FOR [price]
GO
ALTER TABLE [dbo].[orders] ADD  DEFAULT (N'new') FOR [status]
GO
ALTER TABLE [dbo].[order_items] ADD  DEFAULT ((1)) FOR [quantity]
GO
ALTER TABLE [dbo].[order_items]  WITH CHECK ADD  CONSTRAINT [FK_order_items_orders] FOREIGN KEY([order_id])
REFERENCES [dbo].[orders] ([id])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[order_items] CHECK CONSTRAINT [FK_order_items_orders]
GO
ALTER TABLE [dbo].[order_items]  WITH CHECK ADD  CONSTRAINT [FK_order_items_products] FOREIGN KEY([product_id])
REFERENCES [dbo].[products] ([id])
GO
ALTER TABLE [dbo].[order_items] CHECK CONSTRAINT [FK_order_items_products]
GO
ALTER TABLE [dbo].[orders]  WITH CHECK ADD  CONSTRAINT [FK_orders_customers] FOREIGN KEY([customer_id])
REFERENCES [dbo].[customers] ([id])
GO
ALTER TABLE [dbo].[orders] CHECK CONSTRAINT [FK_orders_customers]
GO
ALTER TABLE [dbo].[products]  WITH CHECK ADD  CONSTRAINT [CK_products_price] CHECK  (([price]>=(0)))
GO
ALTER TABLE [dbo].[products] CHECK CONSTRAINT [CK_products_price]
GO
EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'People who buy things' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'customers'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'Login; one account per address' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'customers', @level2type=N'COLUMN',@level2name=N'email'
GO
USE [master]
GO
ALTER DATABASE [shop] SET  READ_WRITE 
GO
