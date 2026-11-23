CREATE TABLE `alerts` (
	`id` varchar(64) NOT NULL,
	`type` varchar(80) NOT NULL,
	`severity` enum('CRITICAL','WARNING','INFO') NOT NULL,
	`description` text NOT NULL,
	`affected_metric` varchar(100) NOT NULL,
	`status` enum('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` int NOT NULL,
	`low_threshold` double NOT NULL,
	`high_threshold` double NOT NULL,
	`latency_threshold` double NOT NULL,
	`drift_threshold` double NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 0,
	`updated_at` timestamp(3) NOT NULL,
	`actor_user_id` int,
	CONSTRAINT `app_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_singleton` CHECK(`app_settings`.`id` = 1),
	CONSTRAINT `settings_threshold_bounds` CHECK(`app_settings`.`low_threshold` BETWEEN 0 AND 1 AND `app_settings`.`high_threshold` BETWEEN 0 AND 1 AND `app_settings`.`drift_threshold` BETWEEN 0 AND 1 AND `app_settings`.`latency_threshold` BETWEEN 50 AND 5000)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`event_order` bigint unsigned AUTO_INCREMENT NOT NULL,
	`id` varchar(64) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`event` varchar(120) NOT NULL,
	`actor_user_id` int,
	`actor_kind` enum('user','demo','system') NOT NULL,
	`actor_label` varchar(160) NOT NULL,
	`resource_type` varchar(64) NOT NULL,
	`resource_id` varchar(100) NOT NULL,
	`details` text NOT NULL,
	`changes` json,
	CONSTRAINT `audit_events_event_order` PRIMARY KEY(`event_order`),
	CONSTRAINT `audit_events_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_deployment_state` (
	`id` int NOT NULL,
	`active_version` varchar(64) NOT NULL,
	`previous_version` varchar(64),
	`next_candidate` int unsigned NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `model_deployment_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `deployment_singleton` CHECK(`model_deployment_state`.`id` = 1)
);
--> statement-breakpoint
CREATE TABLE `model_runs` (
	`id` varchar(64) NOT NULL,
	`version` varchar(64) NOT NULL,
	`dataset` varchar(100) NOT NULL,
	`feature_set` varchar(100) NOT NULL,
	`started_at` timestamp(3) NOT NULL,
	`completed_at` timestamp(3),
	`stage` enum('IDLE','TRAINING','VALIDATING','READY','DEPLOYED','FAILED') NOT NULL,
	`metrics` json,
	`gates` json NOT NULL,
	`message` text NOT NULL,
	`actor_user_id` int,
	CONSTRAINT `model_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_versions` (
	`version` varchar(64) NOT NULL,
	`algorithm` varchar(100) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`dataset` varchar(100) NOT NULL,
	`feature_count` int unsigned NOT NULL,
	`params` text NOT NULL,
	`metrics` json NOT NULL,
	`is_reference` boolean NOT NULL DEFAULT false,
	`artifact` varchar(200),
	CONSTRAINT `model_versions_version` PRIMARY KEY(`version`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_state` (
	`id` int NOT NULL,
	`status` enum('STOPPED','RUNNING','PAUSED') NOT NULL,
	`cursor` int unsigned NOT NULL,
	`started_at` timestamp(3),
	`speed` int NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `pipeline_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `pipeline_singleton` CHECK(`pipeline_state`.`id` = 1),
	CONSTRAINT `pipeline_speed` CHECK(`pipeline_state`.`speed` BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE `scan_history` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` enum('URL','EMAIL') NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`actor_user_id` int,
	`actor_kind` enum('user','demo','system') NOT NULL,
	`verdict` varchar(40) NOT NULL,
	`risk_score` int unsigned NOT NULL,
	`format_version` int unsigned NOT NULL,
	`result` json NOT NULL,
	CONSTRAINT `scan_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `scan_score` CHECK(`scan_history`.`risk_score` BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE `scoring_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`actor_user_id` int,
	`actor_kind` enum('user','demo','system') NOT NULL,
	`dataset` varchar(100) NOT NULL,
	`inputs` json NOT NULL,
	`model_version` varchar(64) NOT NULL,
	`artifact` varchar(200) NOT NULL,
	`probability` double NOT NULL,
	`risk_level` enum('LOW','MEDIUM','HIGH') NOT NULL,
	`prediction` enum('FRAUD','LEGITIMATE') NOT NULL,
	`processing_time_ms` int unsigned NOT NULL,
	`metrics` json NOT NULL,
	`top_risk_factors` json NOT NULL,
	CONSTRAINT `scoring_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `scoring_probability` CHECK(`scoring_requests`.`probability` BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` varchar(64) NOT NULL,
	`stream_sequence` int unsigned NOT NULL,
	`occurred_at` timestamp(3) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`merchant_category` varchar(80) NOT NULL,
	`merchant_id` varchar(64) NOT NULL,
	`merchant_name` varchar(160) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`customer_age` int NOT NULL,
	`customer_location` varchar(80) NOT NULL,
	`merchant_location` varchar(80) NOT NULL,
	`payment_method` varchar(80) NOT NULL,
	`device_type` varchar(80) NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`account_age_days` int NOT NULL,
	`transaction_frequency` int NOT NULL,
	`previous_transaction_amount` decimal(18,2) NOT NULL,
	`distance_from_home` double NOT NULL,
	`failed_attempts` int NOT NULL,
	`hour` int NOT NULL,
	`day_of_week` varchar(12) NOT NULL,
	`is_international` boolean NOT NULL,
	`is_new_device` boolean NOT NULL,
	`is_new_merchant` boolean NOT NULL,
	`velocity_1h` int NOT NULL,
	`velocity_24h` int NOT NULL,
	`amount_deviation` double NOT NULL,
	`risk_score` double NOT NULL,
	`fraud_probability` double NOT NULL,
	`risk_level` enum('LOW','MEDIUM','HIGH') NOT NULL,
	`prediction` enum('FRAUD','LEGITIMATE') NOT NULL,
	`is_fraud` boolean NOT NULL,
	`model_version` varchar(64) NOT NULL,
	`processing_time_ms` int unsigned NOT NULL,
	`risk_factors` json NOT NULL,
	`features` json NOT NULL,
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `transactions_stream_sequence_unique` UNIQUE(`stream_sequence`),
	CONSTRAINT `tx_probability` CHECK(`transactions`.`fraud_probability` BETWEEN 0 AND 1)
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD CONSTRAINT `app_settings_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `model_deployment_state` ADD CONSTRAINT `model_deployment_state_active_version_model_versions_version_fk` FOREIGN KEY (`active_version`) REFERENCES `model_versions`(`version`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `model_deployment_state` ADD CONSTRAINT `deployment_previous_version_fk` FOREIGN KEY (`previous_version`) REFERENCES `model_versions`(`version`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `model_runs` ADD CONSTRAINT `model_runs_version_model_versions_version_fk` FOREIGN KEY (`version`) REFERENCES `model_versions`(`version`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `model_runs` ADD CONSTRAINT `model_runs_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_history` ADD CONSTRAINT `scan_history_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scoring_requests` ADD CONSTRAINT `scoring_requests_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scoring_requests` ADD CONSTRAINT `scoring_requests_model_version_model_versions_version_fk` FOREIGN KEY (`model_version`) REFERENCES `model_versions`(`version`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_model_version_model_versions_version_fk` FOREIGN KEY (`model_version`) REFERENCES `model_versions`(`version`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `alert_status_time` ON `alerts` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_resource_order` ON `audit_events` (`resource_type`,`resource_id`,`event_order`);--> statement-breakpoint
CREATE INDEX `run_version_time` ON `model_runs` (`version`,`started_at`);--> statement-breakpoint
CREATE INDEX `run_time` ON `model_runs` (`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `scan_kind_time` ON `scan_history` (`kind`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `scan_retention` ON `scan_history` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `scoring_retention` ON `scoring_requests` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `tx_risk_sequence` ON `transactions` (`risk_level`,`stream_sequence`);--> statement-breakpoint
CREATE INDEX `tx_prediction_sequence` ON `transactions` (`prediction`,`stream_sequence`);