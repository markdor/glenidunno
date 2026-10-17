CREATE TABLE `distillery_variant_call` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_creation_input_tokens` integer NOT NULL,
	`cache_read_input_tokens` integer NOT NULL,
	`cost_micro_usd` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `distillery_variant_suggestion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_key` text NOT NULL,
	`target_key` text NOT NULL,
	`target_name` text NOT NULL,
	`kind` text NOT NULL,
	`prefix` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "distillery_variant_suggestion_keys" CHECK("distillery_variant_suggestion"."variant_key" <> "distillery_variant_suggestion"."target_key"),
	CONSTRAINT "distillery_variant_suggestion_kind" CHECK("distillery_variant_suggestion"."kind" IN ('spelling', 'brand')),
	CONSTRAINT "distillery_variant_suggestion_status" CHECK("distillery_variant_suggestion"."status" IN ('open', 'rejected')),
	CONSTRAINT "distillery_variant_suggestion_prefix_kind" CHECK(("distillery_variant_suggestion"."prefix" IS NOT NULL) = ("distillery_variant_suggestion"."kind" = 'brand')),
	CONSTRAINT "distillery_variant_suggestion_target_length" CHECK(length("distillery_variant_suggestion"."target_name") BETWEEN 1 AND 60),
	CONSTRAINT "distillery_variant_suggestion_prefix_length" CHECK(length("distillery_variant_suggestion"."prefix") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distillery_variant_suggestion_pair` ON `distillery_variant_suggestion` (`variant_key`,`target_key`);