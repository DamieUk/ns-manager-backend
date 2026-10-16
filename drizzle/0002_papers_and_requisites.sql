ALTER TABLE `clients` ADD `legal_name` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `edrpou` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `legal_address` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `iban` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `bank_name` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `vat_number` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `signatory` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `type` varchar(16) DEFAULT 'framework' NOT NULL;--> statement-breakpoint
ALTER TABLE `contracts` ADD `number` varchar(64);--> statement-breakpoint
ALTER TABLE `contracts` ADD `signed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `contracts` ADD `order_id` char(24);--> statement-breakpoint
ALTER TABLE `documents` ADD `type` varchar(32) DEFAULT 'other' NOT NULL;--> statement-breakpoint
CREATE INDEX `contracts_order_id` ON `contracts` (`order_id`);--> statement-breakpoint
-- Classify files uploaded before document types existed.
UPDATE `documents` d JOIN `products` p ON p.`bom_file_id` = d.`id` SET d.`type` = 'bom';
--> statement-breakpoint
UPDATE `documents` d JOIN `daily_progress` dp ON dp.`photo_id` = d.`id` SET d.`type` = 'photo';
--> statement-breakpoint
-- The first file of a pre-existing contract is the framework contract PDF uploaded with the client.
UPDATE `documents` d JOIN `contract_documents` cd ON cd.`document_id` = d.`id` AND cd.`position` = 0 SET d.`type` = 'framework_contract';
