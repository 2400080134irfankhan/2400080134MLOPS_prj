CREATE TABLE `model_artifacts` (
	`digest` varchar(64) NOT NULL,
	`kind` enum('scorer','manifest') NOT NULL,
	`payload` mediumtext NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `model_artifacts_digest` PRIMARY KEY(`digest`)
);
--> statement-breakpoint
CREATE TRIGGER model_artifacts_no_update BEFORE UPDATE ON model_artifacts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Model artifacts are immutable';
--> statement-breakpoint
CREATE TRIGGER model_artifacts_no_delete BEFORE DELETE ON model_artifacts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Model artifacts are immutable';
