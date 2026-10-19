-- MySQL script made by Puddle from the project's DBML

CREATE SCHEMA IF NOT EXISTS `billing`;

CREATE TABLE `billing`.`accounts` (
  `id` char(36) PRIMARY KEY,
  `plan` ENUM('free', 'pro') DEFAULT 'free' NOT NULL,
  `active` boolean DEFAULT true,
  `settings` json,
  `location` geometry,
  `opened` date COMMENT 'When the account was opened'
) COMMENT='One per paying customer';

CREATE TABLE `authors` (
  `id` bigint AUTO_INCREMENT PRIMARY KEY,
  `name` varchar(80) NOT NULL,
  `account_id` char(36)
);

CREATE TABLE `books` (
  `id` bigint AUTO_INCREMENT PRIMARY KEY,
  `title` text NOT NULL,
  `price` decimal(8,2) CHECK (price > 0),
  `added` datetime DEFAULT (now())
);

CREATE TABLE `books_authors` (
  `books_id` bigint NOT NULL,
  `authors_id` bigint NOT NULL,
  PRIMARY KEY (`books_id`, `authors_id`)
);

ALTER TABLE `authors` ADD FOREIGN KEY (`account_id`) REFERENCES `billing`.`accounts` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `books_authors` ADD FOREIGN KEY (`books_id`) REFERENCES `books` (`id`);
ALTER TABLE `books_authors` ADD FOREIGN KEY (`authors_id`) REFERENCES `authors` (`id`);

INSERT INTO `authors` (`id`, `name`) VALUES
  (1, 'Ursula'),
  (2, 'Terry');
