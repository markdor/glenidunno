PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasting` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`tasting_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`order_opened_at` integer,
	`revealed_at` integer,
	`motto` text,
	`motto_description` text,
	`pour_rules` text,
	`algorithm` text DEFAULT 'taste' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tasting`("id", "slug", "tasting_date", "created_at", "order_opened_at", "revealed_at", "motto", "motto_description", "pour_rules", "algorithm") SELECT "id", "slug", "tasting_date", "created_at", "order_opened_at", "revealed_at", "motto", "motto_description", "pour_rules", "algorithm" FROM `tasting`;--> statement-breakpoint
DROP TABLE `tasting`;--> statement-breakpoint
ALTER TABLE `__new_tasting` RENAME TO `tasting`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasting_slug_unique` ON `tasting` (`slug`);