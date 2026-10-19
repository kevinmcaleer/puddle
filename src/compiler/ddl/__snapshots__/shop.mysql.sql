-- MySQL script made by Puddle from the project's DBML

CREATE TABLE `customers` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `email` varchar(255) NOT NULL UNIQUE,
  `name` varchar(100) NOT NULL,
  `country` char(2) DEFAULT 'GB',
  `created_at` datetime DEFAULT (now())
) COMMENT='Everyone who has signed up';

CREATE TABLE `orders` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `customer_id` int NOT NULL,
  `status` ENUM('pending', 'paid', 'shipped', 'cancelled') DEFAULT 'pending' NOT NULL,
  `total` decimal(10,2) NOT NULL CHECK (total >= 0),
  `ordered_at` datetime NOT NULL
);

CREATE INDEX `orders_by_customer` ON `orders` (`customer_id`, `ordered_at`);

CREATE TABLE `products` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `sku` varchar(32) NOT NULL UNIQUE,
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL
);

CREATE TABLE `order_items` (
  `order_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int DEFAULT 1 NOT NULL,
  PRIMARY KEY (`order_id`, `product_id`)
);

ALTER TABLE `orders` ADD FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);
ALTER TABLE `order_items` ADD FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE;
ALTER TABLE `order_items` ADD FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
