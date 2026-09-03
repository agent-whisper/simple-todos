ALTER TABLE `task` ADD `working_on_at` text;--> statement-breakpoint
CREATE INDEX `task_working_on_idx` ON `task` ("working_on_at" DESC) WHERE working_on_at IS NOT NULL;