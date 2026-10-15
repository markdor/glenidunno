CREATE TABLE `startup_job` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`message` text,
	`progress_done` integer,
	`progress_total` integer,
	CONSTRAINT "startup_job_status" CHECK("startup_job"."status" IN ('running', 'succeeded', 'failed'))
);
