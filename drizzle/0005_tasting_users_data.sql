-- Data migration for #16 (tasting links bound to logins instead of tokens).
-- Runs between 0004 (new nullable columns) and 0006 (rebuild with NOT NULL),
-- so the rebuild finds user_id and slug already filled in. Must also work on
-- an empty database.
--
-- Word lists for the links /tasting/<adjective>-<animal>: lower-case a–z only.
INSERT INTO `tasting_slug_adjective` (`word`) VALUES
	('bouncy'), ('brave'), ('breezy'), ('bright'), ('bubbly'), ('calm'), ('cheeky'), ('cheerful'),
	('cheery'), ('chirpy'), ('classy'), ('clever'), ('comfy'), ('cozy'), ('cuddly'), ('curious'),
	('cute'), ('dainty'), ('dandy'), ('dapper'), ('dazzling'), ('dreamy'), ('eager'), ('fancy'),
	('fearless'), ('festive'), ('fizzy'), ('fluffy'), ('friendly'), ('frisky'), ('funny'), ('fuzzy'),
	('gentle'), ('giggly'), ('gleeful'), ('glowing'), ('golden'), ('graceful'), ('groovy'), ('happy'),
	('hearty'), ('helpful'), ('humble'), ('jaunty'), ('jazzy'), ('jolly'), ('joyful'), ('keen'),
	('kind'), ('lively'), ('lovely'), ('lucky'), ('mellow'), ('merry'), ('mighty'), ('misty'),
	('nifty'), ('nimble'), ('noble'), ('peppy'), ('perky'), ('playful'), ('plucky'), ('polite'),
	('precious'), ('pretty'), ('proud'), ('puffy'), ('quiet'), ('quirky'), ('radiant'), ('rosy'),
	('sassy'), ('shiny'), ('silky'), ('silly'), ('sleepy'), ('smiley'), ('snappy'), ('snowy'),
	('snuggly'), ('soft'), ('sparkly'), ('speedy'), ('spry'), ('spunky'), ('squishy'), ('starry'),
	('sunny'), ('sweet'), ('swift'), ('tender'), ('tiny'), ('toasty'), ('trusty'), ('twinkly'),
	('velvety'), ('warm'), ('witty'), ('zippy');
--> statement-breakpoint
INSERT INTO `tasting_slug_animal` (`word`) VALUES
	('alpaca'), ('axolotl'), ('badger'), ('bear'), ('beaver'), ('bee'), ('bunny'), ('butterfly'),
	('calf'), ('camel'), ('capybara'), ('cat'), ('chick'), ('chickadee'), ('chinchilla'), ('chipmunk'),
	('cub'), ('deer'), ('dolphin'), ('dormouse'), ('dove'), ('duck'), ('duckling'), ('elephant'),
	('emu'), ('fawn'), ('ferret'), ('finch'), ('flamingo'), ('foal'), ('fox'), ('frog'),
	('gazelle'), ('gecko'), ('gerbil'), ('giraffe'), ('goat'), ('goose'), ('gosling'), ('hamster'),
	('hedgehog'), ('hippo'), ('hummingbird'), ('ibex'), ('kangaroo'), ('kitten'), ('kiwi'), ('koala'),
	('lamb'), ('lemur'), ('llama'), ('lynx'), ('magpie'), ('manatee'), ('marmot'), ('meerkat'),
	('mole'), ('mongoose'), ('moose'), ('mouse'), ('narwhal'), ('newt'), ('ocelot'), ('octopus'),
	('otter'), ('owl'), ('owlet'), ('panda'), ('parrot'), ('peacock'), ('pelican'), ('penguin'),
	('piglet'), ('pony'), ('porcupine'), ('possum'), ('puffin'), ('puppy'), ('quail'), ('quokka'),
	('rabbit'), ('raccoon'), ('reindeer'), ('robin'), ('seal'), ('sheep'), ('sloth'), ('snail'),
	('sparrow'), ('squirrel'), ('stoat'), ('swan'), ('tapir'), ('toucan'), ('turtle'), ('walrus'),
	('whale'), ('wombat'), ('wren'), ('zebra');
--> statement-breakpoint
-- Participants become users. A participant whose name matches a username
-- (case-insensitive; SQLite's lower() folds ASCII only, which is enough as
-- USERNAME_RE allows ASCII only) is that user. Every other name becomes a new
-- user with the name as username – the same name in several tastings is one
-- user. `seen` orders the names by first appearance.
CREATE TEMP TABLE `_migration_participant_name` AS
SELECT
	`p`.`id` AS `participant_id`,
	lower(trim(`p`.`name`)) AS `name_key`,
	trim(`p`.`name`) AS `name`,
	row_number() OVER (
		ORDER BY `t`.`created_at`, `t`.`rowid`, `p`.`created_at`, `p`.`rowid`
	) AS `seen`
FROM `tasting_participant` `p`
INNER JOIN `tasting` `t` ON `t`.`id` = `p`.`tasting_id`;
--> statement-breakpoint
-- New users get a UUID (v4 format, like randomUUID() elsewhere) and an
-- undeliverable placeholder address under the reserved TLD .invalid, numbered
-- by first appearance: dummy-1@dummy.invalid, dummy-2@… – the admin enters
-- the real address on /admin later.
CREATE TEMP TABLE `_migration_new_user` AS
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2)
		|| '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2)
		|| '-' || hex(randomblob(6))
	) AS `id`,
	(
		SELECT `f`.`name` FROM `_migration_participant_name` `f`
		WHERE `f`.`name_key` = `n`.`name_key`
		ORDER BY `f`.`seen` LIMIT 1
	) AS `username`,
	row_number() OVER (ORDER BY min(`n`.`seen`)) AS `number`
FROM `_migration_participant_name` `n`
WHERE NOT EXISTS (SELECT 1 FROM `user` `u` WHERE lower(`u`.`username`) = `n`.`name_key`)
GROUP BY `n`.`name_key`;
--> statement-breakpoint
INSERT INTO `user`
	(`id`, `name`, `email`, `email_verified`, `created_at`, `updated_at`, `username`, `is_admin`)
SELECT
	`id`, `username`, 'dummy-' || `number` || '@dummy.invalid', 1, unixepoch(), unixepoch(),
	`username`, 0
FROM `_migration_new_user`;
--> statement-breakpoint
UPDATE `tasting_participant` SET `user_id` = (
	SELECT `u`.`id` FROM `user` `u`
	WHERE lower(`u`.`username`) = lower(trim(`tasting_participant`.`name`))
	ORDER BY `u`.`created_at`, `u`.`rowid` LIMIT 1
);
--> statement-breakpoint
-- Every existing tasting gets a link: the free combinations are shuffled once
-- into a table (a random() inside the UPDATE could hand out a slug twice) and
-- dealt out by position.
CREATE TEMP TABLE `_migration_free_slug` AS
SELECT
	`a`.`word` || '-' || `n`.`word` AS `slug`,
	row_number() OVER (ORDER BY random()) AS `position`
FROM `tasting_slug_adjective` `a`
CROSS JOIN `tasting_slug_animal` `n`
WHERE `a`.`word` || '-' || `n`.`word` NOT IN (
	SELECT `slug` FROM `tasting` WHERE `slug` IS NOT NULL
);
--> statement-breakpoint
CREATE TEMP TABLE `_migration_tasting_position` AS
SELECT `id`, row_number() OVER (ORDER BY `created_at`, `rowid`) AS `position`
FROM `tasting`
WHERE `slug` IS NULL;
--> statement-breakpoint
UPDATE `tasting` SET `slug` = (
	SELECT `f`.`slug` FROM `_migration_free_slug` `f`
	INNER JOIN `_migration_tasting_position` `t` ON `t`.`position` = `f`.`position`
	WHERE `t`.`id` = `tasting`.`id`
)
WHERE `slug` IS NULL;
--> statement-breakpoint
DROP TABLE `_migration_participant_name`;
--> statement-breakpoint
DROP TABLE `_migration_new_user`;
--> statement-breakpoint
DROP TABLE `_migration_free_slug`;
--> statement-breakpoint
DROP TABLE `_migration_tasting_position`;
