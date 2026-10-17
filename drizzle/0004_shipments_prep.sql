CREATE TABLE `order_prep` (
	`order_id` char(24) NOT NULL,
	`item` varchar(24) NOT NULL,
	`status` varchar(16) NOT NULL,
	`document_id` char(24),
	`note` text,
	`updated_by` char(24) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `order_prep_order_id_item_pk` PRIMARY KEY(`order_id`,`item`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `shipment_lines` (
	`shipment_id` char(24) NOT NULL,
	`position` int NOT NULL,
	`order_id` char(24) NOT NULL,
	`description` text NOT NULL,
	`quantity` int NOT NULL,
	`unit_price` decimal(14,2) NOT NULL,
	CONSTRAINT `shipment_lines_shipment_id_position_pk` PRIMARY KEY(`shipment_id`,`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` char(24) NOT NULL,
	`number` varchar(24) NOT NULL,
	`client_id` char(24) NOT NULL,
	`shipped_at` datetime(3) NOT NULL,
	`vat_rate` int NOT NULL,
	`carrier` varchar(64),
	`tracking_number` varchar(64),
	`note` text,
	`created_by` char(24) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `shipments_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipments_number` UNIQUE(`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `description` text;--> statement-breakpoint
CREATE INDEX `shipment_lines_order_id` ON `shipment_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `shipments_client_id` ON `shipments` (`client_id`);