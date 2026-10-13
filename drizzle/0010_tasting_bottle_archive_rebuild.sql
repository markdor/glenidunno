PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasting_bottle` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`slot` integer NOT NULL,
	`alias` text NOT NULL,
	`distillery` text NOT NULL,
	`bottler` text,
	`bottling` text,
	`age` integer,
	`whiskybase_url` text,
	`smoke` integer,
	`cask` integer,
	`abv` real NOT NULL,
	`value` integer,
	`archived` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`presentation_file` text,
	`presentation_name` text,
	FOREIGN KEY (`participant_id`) REFERENCES `tasting_participant`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasting_bottle_slot_range" CHECK("__new_tasting_bottle"."slot" BETWEEN 1 AND 6),
	CONSTRAINT "tasting_bottle_alias_length" CHECK(length("__new_tasting_bottle"."alias") BETWEEN 1 AND 30),
	CONSTRAINT "tasting_bottle_distillery_length" CHECK(length("__new_tasting_bottle"."distillery") BETWEEN 1 AND 60),
	CONSTRAINT "tasting_bottle_bottler_length" CHECK(length("__new_tasting_bottle"."bottler") BETWEEN 1 AND 60),
	CONSTRAINT "tasting_bottle_bottling_length" CHECK(length("__new_tasting_bottle"."bottling") BETWEEN 1 AND 120),
	CONSTRAINT "tasting_bottle_age_range" CHECK("__new_tasting_bottle"."age" BETWEEN 1 AND 80),
	CONSTRAINT "tasting_bottle_whiskybase_url_length" CHECK(length("__new_tasting_bottle"."whiskybase_url") BETWEEN 1 AND 300),
	CONSTRAINT "tasting_bottle_smoke_range" CHECK("__new_tasting_bottle"."smoke" BETWEEN 0 AND 5),
	CONSTRAINT "tasting_bottle_cask_range" CHECK("__new_tasting_bottle"."cask" BETWEEN 0 AND 5),
	CONSTRAINT "tasting_bottle_abv_range" CHECK("__new_tasting_bottle"."abv" BETWEEN 35 AND 75),
	CONSTRAINT "tasting_bottle_value_range" CHECK("__new_tasting_bottle"."value" BETWEEN 0 AND 5),
	CONSTRAINT "tasting_bottle_archived_factors" CHECK(("__new_tasting_bottle"."archived" = 0 AND "__new_tasting_bottle"."smoke" IS NOT NULL AND "__new_tasting_bottle"."cask" IS NOT NULL AND "__new_tasting_bottle"."value" IS NOT NULL) OR ("__new_tasting_bottle"."archived" = 1 AND "__new_tasting_bottle"."smoke" IS NULL AND "__new_tasting_bottle"."cask" IS NULL AND "__new_tasting_bottle"."value" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_tasting_bottle`("id", "participant_id", "slot", "alias", "distillery", "bottler", "bottling", "age", "whiskybase_url", "smoke", "cask", "abv", "value", "archived", "updated_at", "presentation_file", "presentation_name") SELECT "id", "participant_id", "slot", "alias", "distillery", "bottler", "bottling", "age", "whiskybase_url", "smoke", "cask", "abv", "value", "archived", "updated_at", "presentation_file", "presentation_name" FROM `tasting_bottle`;--> statement-breakpoint
DROP TABLE `tasting_bottle`;--> statement-breakpoint
ALTER TABLE `__new_tasting_bottle` RENAME TO `tasting_bottle`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasting_bottle_participant_slot_unique` ON `tasting_bottle` (`participant_id`,`slot`);