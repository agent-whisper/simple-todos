CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_name_unique` ON `category` (lower("name"));--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`run_date` text NOT NULL,
	`ran_at` text NOT NULL,
	CONSTRAINT "job_run_name" CHECK(job_name IN ('sweep', 'reminder'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_run_unique` ON `job_run` (`job_name`,`run_date`);--> statement-breakpoint
CREATE TABLE `recurrence_log` (
	`id` text PRIMARY KEY NOT NULL,
	`recurrence_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`recurrence_id`) REFERENCES `recurrence`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurrence_log_status" CHECK(status IN ('completed', 'missed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurrence_log_unique` ON `recurrence_log` (`recurrence_id`,`occurrence_date`);--> statement-breakpoint
CREATE TABLE `recurrence` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`priority` text DEFAULT 'should' NOT NULL,
	`category_id` text,
	`schedule_kind` text NOT NULL,
	`days_of_week` text,
	`active` integer DEFAULT 1 NOT NULL,
	`last_processed_date` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurrence_priority" CHECK(priority IN ('must', 'should', 'could')),
	CONSTRAINT "recurrence_schedule_kind" CHECK(schedule_kind IN ('daily', 'weekly')),
	CONSTRAINT "recurrence_days_of_week" CHECK((schedule_kind = 'weekly') = (days_of_week IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`sweep_time` text DEFAULT '03:00' NOT NULL,
	`reminder_enabled` integer DEFAULT 0 NOT NULL,
	`reminder_time` text DEFAULT '08:00' NOT NULL,
	`webhook_kind` text,
	`webhook_url` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_singleton" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_webhook_kind" CHECK(webhook_kind IS NULL OR webhook_kind IN ('discord', 'slack'))
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`root_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`notes_updated_at` text,
	`priority` text DEFAULT 'should' NOT NULL,
	`category_id` text,
	`due_date` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`archived_at` text,
	`recurrence_id` text,
	`occurrence_date` text,
	FOREIGN KEY (`parent_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurrence_id`) REFERENCES `recurrence`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "task_priority" CHECK(priority IN ('must', 'should', 'could')),
	CONSTRAINT "task_archived_implies_completed" CHECK(archived_at IS NULL OR completed_at IS NOT NULL),
	CONSTRAINT "task_occurrence_date" CHECK(recurrence_id IS NULL OR occurrence_date IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `task_root_idx` ON `task` (`root_id`);--> statement-breakpoint
CREATE INDEX `task_parent_idx` ON `task` (`parent_id`);--> statement-breakpoint
CREATE INDEX `task_active_idx` ON `task` (`archived_at`) WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX `task_notes_idx` ON `task` ("notes_updated_at" DESC) WHERE notes IS NOT NULL AND notes <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `task_occurrence_unique` ON `task` (`recurrence_id`,`occurrence_date`) WHERE recurrence_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "user_singleton" CHECK("user"."id" = 1)
);
