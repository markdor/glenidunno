PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasting_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`tasting_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tasting_id`) REFERENCES `tasting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_tasting_participant`("id", "tasting_id", "user_id", "created_at") SELECT "id", "tasting_id", "user_id", "created_at" FROM `tasting_participant`;--> statement-breakpoint
DROP TABLE `tasting_participant`;--> statement-breakpoint
ALTER TABLE `__new_tasting_participant` RENAME TO `tasting_participant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasting_participant_tasting_user_unique` ON `tasting_participant` (`tasting_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_tasting` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tasting_date` text NOT NULL,
	`bottles_per_participant` integer NOT NULL,
	`created_at` integer NOT NULL,
	`order_opened_at` integer,
	`revealed_at` integer,
	CONSTRAINT "tasting_name_length" CHECK(length("__new_tasting"."name") BETWEEN 1 AND 60),
	CONSTRAINT "tasting_bottles_per_participant_range" CHECK("__new_tasting"."bottles_per_participant" BETWEEN 1 AND 6)
);
--> statement-breakpoint
INSERT INTO `__new_tasting`("id", "slug", "name", "tasting_date", "bottles_per_participant", "created_at", "order_opened_at", "revealed_at") SELECT "id", "slug", "name", "tasting_date", "bottles_per_participant", "created_at", "order_opened_at", "revealed_at" FROM `tasting`;--> statement-breakpoint
DROP TABLE `tasting`;--> statement-breakpoint
ALTER TABLE `__new_tasting` RENAME TO `tasting`;--> statement-breakpoint
CREATE UNIQUE INDEX `tasting_slug_unique` ON `tasting` (`slug`);