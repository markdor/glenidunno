CREATE TABLE `tasting_slug_adjective` (
	`word` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasting_slug_animal` (
	`word` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasting` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tasting_slug_unique` ON `tasting` (`slug`);--> statement-breakpoint
ALTER TABLE `tasting_participant` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `deactivated_at` integer;