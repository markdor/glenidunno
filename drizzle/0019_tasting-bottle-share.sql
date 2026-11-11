CREATE TABLE `tasting_bottle_share` (
	`token` text PRIMARY KEY NOT NULL,
	`bottle_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bottle_id`) REFERENCES `tasting_bottle`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasting_bottle_share_token_length" CHECK(length("tasting_bottle_share"."token") = 43)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasting_bottle_share_bottle_id_unique` ON `tasting_bottle_share` (`bottle_id`);