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
ALTER TABLE `orders` ADD `number` varchar(16);--> statement-breakpoint
ALTER TABLE `orders` ADD `stage` varchar(16) DEFAULT 'quote' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `stage_changed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `orders` ADD `quote_amount` decimal(14,2);--> statement-breakpoint
ALTER TABLE `orders` ADD `quote_currency` varchar(3);--> statement-breakpoint
ALTER TABLE `orders` ADD `exchange_rate` decimal(12,4);--> statement-breakpoint
ALTER TABLE `orders` ADD `price_uah` decimal(14,2);--> statement-breakpoint
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
CREATE INDEX `order_stage_events_order_id` ON `order_stage_events` (`order_id`);--> statement-breakpoint
CREATE INDEX `orders_stage` ON `orders` (`stage`);
