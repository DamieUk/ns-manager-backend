CREATE TABLE `company` (
	`id` varchar(16) NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`edrpou` varchar(10),
	`legal_address` text,
	`iban` varchar(34),
	`bank_name` text,
	`bank_mfo` varchar(6),
	`bank_edrpou` varchar(8),
	`vat_payer` boolean NOT NULL DEFAULT false,
	`vat_number` varchar(12),
	`tax_note` text,
	`signatory` text,
	`phone` varchar(32),
	`email` varchar(255),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `company_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` char(24) NOT NULL,
	`number` varchar(24) NOT NULL,
	`order_id` char(24) NOT NULL,
	`client_id` char(24) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`vat_rate` int NOT NULL,
	`issued_at` datetime(3) NOT NULL,
	`due_at` datetime(3),
	`status` varchar(16) NOT NULL,
	`paid_amount` decimal(14,2),
	`paid_at` datetime(3),
	`note` text,
	`created_by` char(24) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_number` UNIQUE(`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `order_stage_events` (
	`id` char(24) NOT NULL,
	`order_id` char(24) NOT NULL,
	`from_stage` varchar(16),
	`to_stage` varchar(16) NOT NULL,
	`user_id` char(24),
	`note` text,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `order_stage_events_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` char(24) NOT NULL,
	`order_id` char(24) NOT NULL,
	`category` varchar(16) NOT NULL,
	`supplier` varchar(64) NOT NULL,
	`description` text,
	`supplier_order_no` varchar(64),
	`tracking_number` varchar(64),
	`cost` decimal(14,2),
	`currency` varchar(3),
	`status` varchar(16) NOT NULL,
	`ordered_at` datetime(3),
	`expected_at` datetime(3),
	`received_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `purchases_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
ALTER TABLE `orders` ADD `number` varchar(16);--> statement-breakpoint
ALTER TABLE `orders` ADD `stage` varchar(16) DEFAULT 'quote' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `stage_changed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `orders` ADD `unit_quote` decimal(14,2);--> statement-breakpoint
ALTER TABLE `orders` ADD `quote_currency` varchar(3);--> statement-breakpoint
ALTER TABLE `orders` ADD `exchange_rate` decimal(12,4);--> statement-breakpoint
ALTER TABLE `orders` ADD `unit_price` decimal(14,2);--> statement-breakpoint
-- Number existing orders by creation date within each year: 26-001, 26-002, ...
UPDATE `orders` o JOIN (
	SELECT `id`, ROW_NUMBER() OVER (PARTITION BY YEAR(`created_at`) ORDER BY `created_at`, `id`) AS `seq` FROM `orders`
) n ON n.`id` = o.`id`
SET o.`number` = CONCAT(DATE_FORMAT(o.`created_at`, '%y'), '-', LPAD(n.`seq`, 3, '0'));
--> statement-breakpoint
-- Orders from before stages existed were in production.
UPDATE `orders` SET
	`stage` = CASE `status` WHEN 'completed' THEN 'done' WHEN 'cancelled' THEN 'cancelled' ELSE 'assembly' END,
	`stage_changed_at` = `updated_at`;
--> statement-breakpoint
INSERT INTO `order_stage_events` (`id`, `order_id`, `from_stage`, `to_stage`, `user_id`, `note`, `created_at`)
SELECT LEFT(MD5(CONCAT('stage:', `id`)), 24), `id`, NULL, `stage`, NULL, NULL, `created_at` FROM `orders`;
--> statement-breakpoint
ALTER TABLE `orders` MODIFY `number` varchar(16) NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` MODIFY `stage_changed_at` datetime(3) NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_number` UNIQUE(`number`);--> statement-breakpoint
CREATE INDEX `invoices_order_id` ON `invoices` (`order_id`);--> statement-breakpoint
CREATE INDEX `invoices_status` ON `invoices` (`status`);--> statement-breakpoint
CREATE INDEX `order_stage_events_order_id` ON `order_stage_events` (`order_id`);--> statement-breakpoint
CREATE INDEX `purchases_order_id` ON `purchases` (`order_id`);--> statement-breakpoint
CREATE INDEX `purchases_status` ON `purchases` (`status`);--> statement-breakpoint
CREATE INDEX `orders_stage` ON `orders` (`stage`);--> statement-breakpoint
-- Our requisites, as on the delivery notes issued so far; editable on the «Компанія» page.
INSERT INTO `company` (`id`, `name`, `legal_name`, `edrpou`, `legal_address`, `iban`, `bank_name`, `bank_mfo`, `bank_edrpou`, `vat_payer`, `vat_number`, `signatory`, `updated_at`)
VALUES ('main', 'Numenor Systems', 'ТОВ "НУМЕНОР СІСТЕМС"', '46071360',
	'Україна, 76002, Івано-Франківська обл., Івано-Франківський р-н, село Вовчинець, вул. Вовчинецька, буд. 225',
	'UA473220010000026003700010314', 'АТ "УНІВЕРСАЛ БАНК"', '322001', '21133352', TRUE, '460713609154', 'Полтавський Д.О.', NOW(3));
