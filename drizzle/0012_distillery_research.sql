CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `distillery` (
	`name_key` text PRIMARY KEY NOT NULL,
	`country` text,
	`country_state` text DEFAULT 'pending' NOT NULL,
	`country_source` text,
	`country_rules` text,
	`region` text,
	`region_state` text DEFAULT 'pending' NOT NULL,
	`region_source` text,
	`region_rules` text,
	`capacity` integer,
	`capacity_state` text DEFAULT 'pending' NOT NULL,
	`capacity_source` text,
	`capacity_rules` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "distillery_country_state" CHECK("distillery"."country_state" IN ('pending', 'found', 'admin', 'empty')),
	CONSTRAINT "distillery_country_value_state" CHECK(("distillery"."country" IS NOT NULL) = ("distillery"."country_state" IN ('found', 'admin'))),
	CONSTRAINT "distillery_country_source_state" CHECK(("distillery"."country_source" IS NULL AND "distillery"."country_rules" IS NULL) OR "distillery"."country_state" = 'found'),
	CONSTRAINT "distillery_country_source_length" CHECK(length("distillery"."country_source") BETWEEN 1 AND 2048),
	CONSTRAINT "distillery_region_state" CHECK("distillery"."region_state" IN ('pending', 'found', 'admin', 'empty')),
	CONSTRAINT "distillery_region_value_state" CHECK(("distillery"."region" IS NOT NULL) = ("distillery"."region_state" IN ('found', 'admin'))),
	CONSTRAINT "distillery_region_source_state" CHECK(("distillery"."region_source" IS NULL AND "distillery"."region_rules" IS NULL) OR "distillery"."region_state" = 'found'),
	CONSTRAINT "distillery_region_source_length" CHECK(length("distillery"."region_source") BETWEEN 1 AND 2048),
	CONSTRAINT "distillery_capacity_state" CHECK("distillery"."capacity_state" IN ('pending', 'found', 'admin', 'empty')),
	CONSTRAINT "distillery_capacity_value_state" CHECK(("distillery"."capacity" IS NOT NULL) = ("distillery"."capacity_state" IN ('found', 'admin'))),
	CONSTRAINT "distillery_capacity_source_state" CHECK(("distillery"."capacity_source" IS NULL AND "distillery"."capacity_rules" IS NULL) OR "distillery"."capacity_state" = 'found'),
	CONSTRAINT "distillery_capacity_source_length" CHECK(length("distillery"."capacity_source") BETWEEN 1 AND 2048),
	CONSTRAINT "distillery_country_length" CHECK(length("distillery"."country") BETWEEN 1 AND 60),
	CONSTRAINT "distillery_region_list" CHECK("distillery"."region" IN ('Islay', 'Campbeltown', 'Inseln', 'Speyside', 'Highlands', 'Lowlands')),
	CONSTRAINT "distillery_region_country" CHECK("distillery"."region" IS NULL OR "distillery"."country" = 'Schottland'),
	CONSTRAINT "distillery_capacity_range" CHECK("distillery"."capacity" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE `distillery_research_call` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`name_key` text NOT NULL,
	`stage` integer NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_creation_input_tokens` integer NOT NULL,
	`cache_read_input_tokens` integer NOT NULL,
	`web_search_requests` integer NOT NULL,
	`web_fetch_requests` integer NOT NULL,
	`cost_micro_usd` integer NOT NULL,
	CONSTRAINT "distillery_research_call_stage" CHECK("distillery_research_call"."stage" IN (1, 2))
);
--> statement-breakpoint
CREATE INDEX `distillery_research_call_name_key` ON `distillery_research_call` (`name_key`);