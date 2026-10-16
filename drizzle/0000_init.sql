CREATE TABLE `clients` (
	`id` char(24) NOT NULL,
	`name` text NOT NULL,
	`code` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL,
	`contact_name` text,
	`email` text,
	`phone` text,
	`address` text,
	`notes` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `code` UNIQUE(`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `contract_documents` (
	`contract_id` char(24) NOT NULL,
	`position` int NOT NULL,
	`document_id` char(24) NOT NULL,
	CONSTRAINT `contract_documents_contract_id_position_pk` PRIMARY KEY(`contract_id`,`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` char(24) NOT NULL,
	`title` text NOT NULL,
	`client_id` char(24) NOT NULL,
	`start_date` datetime(3),
	`end_date` datetime(3),
	`status` varchar(16) NOT NULL,
	`notes` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `contracts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `daily_progress` (
	`id` char(24) NOT NULL,
	`employee_id` char(24) NOT NULL,
	`order_id` char(24) NOT NULL,
	`date` datetime(3) NOT NULL,
	`completed` int NOT NULL,
	`needs_rework` int NOT NULL,
	`partially_assembled` int NOT NULL,
	`notes` text,
	`photo_id` char(24),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `daily_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_order_date` UNIQUE(`employee_id`,`order_id`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` char(24) NOT NULL,
	`client_id` char(24) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`size` int NOT NULL,
	`uploaded_by` char(24) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `order_documents` (
	`order_id` char(24) NOT NULL,
	`position` int NOT NULL,
	`document_id` char(24) NOT NULL,
	CONSTRAINT `order_documents_order_id_position_pk` PRIMARY KEY(`order_id`,`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `order_employees` (
	`order_id` char(24) NOT NULL,
	`position` int NOT NULL,
	`user_id` char(24) NOT NULL,
	CONSTRAINT `order_employees_order_id_position_pk` PRIMARY KEY(`order_id`,`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` char(24) NOT NULL,
	`client_id` char(24) NOT NULL,
	`product_id` char(24) NOT NULL,
	`quantity` int NOT NULL,
	`description` text NOT NULL,
	`status` varchar(16) NOT NULL,
	`due_date` datetime(3),
	`manager_id` char(24),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `product_files` (
	`product_id` char(24) NOT NULL,
	`position` int NOT NULL,
	`document_id` char(24) NOT NULL,
	CONSTRAINT `product_files_product_id_position_pk` PRIMARY KEY(`product_id`,`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `products` (
	`id` char(24) NOT NULL,
	`client_id` char(24) NOT NULL,
	`name` text NOT NULL,
	`sku` varchar(255) NOT NULL,
	`type` varchar(16) NOT NULL,
	`description` text,
	`bom_file_id` char(24),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `sku` UNIQUE(`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` char(64) NOT NULL,
	`user_id` char(24) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_token_hash` PRIMARY KEY(`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(24) NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`job_title` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`status` varchar(16) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` varchar(16) NOT NULL,
	`permissions` text NOT NULL,
	`avatar_url` text,
	`is_active` boolean NOT NULL,
	`password_hash` varchar(255),
	`email_verified` boolean NOT NULL,
	`password_token_hash` char(64),
	`password_token_expires` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `email` UNIQUE(`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE INDEX `contracts_client_id` ON `contracts` (`client_id`);--> statement-breakpoint
CREATE INDEX `daily_progress_order_id` ON `daily_progress` (`order_id`);--> statement-breakpoint
CREATE INDEX `daily_progress_date` ON `daily_progress` (`date`);--> statement-breakpoint
CREATE INDEX `documents_client_id` ON `documents` (`client_id`);--> statement-breakpoint
CREATE INDEX `order_employees_user_id` ON `order_employees` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_client_id` ON `orders` (`client_id`);--> statement-breakpoint
CREATE INDEX `orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `products_client_id` ON `products` (`client_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `users_password_token_hash` ON `users` (`password_token_hash`);