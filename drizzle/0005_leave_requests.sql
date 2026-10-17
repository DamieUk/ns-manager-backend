CREATE TABLE `leave_requests` (
	`id` char(24) NOT NULL,
	`user_id` char(24) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`start_date` datetime(3) NOT NULL,
	`end_date` datetime(3) NOT NULL,
	`reason` text,
	`status` varchar(16) NOT NULL,
	`decided_by` char(24),
	`decided_at` datetime(3),
	`decision_note` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `leave_requests_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE INDEX `leave_requests_user_id` ON `leave_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `leave_requests_status` ON `leave_requests` (`status`);