ALTER TABLE `tasting` ADD `pour_rules` text;--> statement-breakpoint
ALTER TABLE `tasting_bottle` ADD `pour_position` integer;--> statement-breakpoint
ALTER TABLE `tasting_bottle` ADD `pour_score` real;--> statement-breakpoint
ALTER TABLE `tasting_bottle` ADD `pour_smoke_share` real;--> statement-breakpoint
ALTER TABLE `tasting_bottle` ADD `pour_cask_share` real;--> statement-breakpoint
ALTER TABLE `tasting_bottle` ADD `pour_abv_share` real;--> statement-breakpoint
ALTER TABLE `tasting_bottle` ADD `pour_value_share` real;