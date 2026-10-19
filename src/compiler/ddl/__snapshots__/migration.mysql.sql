-- MySQL migration made by Puddle from the saved version to the project's DBML

-- By hand: The foreign key from orders to products has no name in the DBML: look up the name MySQL gave it and drop it.

ALTER TABLE `vendors` RENAME TO `suppliers`;
ALTER TABLE `reviews` RENAME COLUMN `body` TO `comment`;

ALTER TABLE `customers` ADD COLUMN `referrer_id` int;
ALTER TABLE `orders` ADD COLUMN `shipped_at` datetime;

ALTER TABLE `customers` MODIFY COLUMN `name` varchar(100) NOT NULL;
ALTER TABLE `customers` MODIFY COLUMN `country` char(2) DEFAULT 'US';
-- Loses data: narrows products.sku from varchar(32) to varchar(16)
ALTER TABLE `products` MODIFY COLUMN `sku` varchar(16) NOT NULL;
ALTER TABLE `products` MODIFY COLUMN `price` decimal(10,2);
ALTER TABLE `orders` MODIFY COLUMN `status` ENUM('pending', 'paid', 'shipped', 'refunded') DEFAULT 'pending' NOT NULL;
ALTER TABLE `orders` MODIFY COLUMN `total` decimal(12,2) NOT NULL;
-- Loses data: narrows orders.note from text to varchar(500)
ALTER TABLE `orders` MODIFY COLUMN `note` varchar(500);

-- Loses data: drops column orders.legacy_code
ALTER TABLE `orders` DROP COLUMN `legacy_code`;

CREATE TABLE `refunds` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `order_id` int NOT NULL,
  `supplier_id` int,
  `amount` decimal(10,2) NOT NULL
);
CREATE INDEX `refunds_index_1` ON `refunds` (`order_id`);

CREATE INDEX `orders_index_1` ON `orders` (`customer_id`, `status`);
ALTER TABLE `refunds` ADD FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`);
ALTER TABLE `refunds` ADD FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`);
ALTER TABLE `customers` ADD FOREIGN KEY (`referrer_id`) REFERENCES `customers` (`id`);

-- Loses data: drops table audit_log
DROP TABLE `audit_log`;
