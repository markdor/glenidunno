PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasting` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tasting_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`order_opened_at` integer,
	`revealed_at` integer,
	`motto` text,
	CONSTRAINT "tasting_name_length" CHECK(length("__new_tasting"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
INSERT INTO `__new_tasting`("id", "slug", "name", "tasting_date", "created_at", "order_opened_at", "revealed_at", "motto") SELECT "id", "slug", "name", "tasting_date", "created_at", "order_opened_at", "revealed_at", "motto" FROM `tasting`;--> statement-breakpoint
DROP TABLE `tasting`;--> statement-breakpoint
ALTER TABLE `__new_tasting` RENAME TO `tasting`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasting_slug_unique` ON `tasting` (`slug`);