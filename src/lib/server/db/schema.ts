import { sql, type SQL } from 'drizzle-orm';
import {
	sqliteTable,
	text,
	integer,
	real,
	check,
	index,
	uniqueIndex,
	type SQLiteColumn
} from 'drizzle-orm/sqlite-core';
// Relative import on purpose: drizzle-kit loads this file outside of Vite and
// doesn't know the $lib alias.
import {
	DISTILLERY_CAPACITY,
	DISTILLERY_COUNTRY_LENGTH,
	DISTILLERY_SOURCE_LENGTH,
	DISTILLERY_VALUE_STATES,
	SCOTLAND,
	SCOTTISH_REGIONS,
	TASTING_ABV,
	TASTING_AGE,
	TASTING_ALIAS_LENGTH,
	TASTING_BOTTLE_SLOTS,
	TASTING_BOTTLER_LENGTH,
	TASTING_BOTTLING_LENGTH,
	TASTING_DISTILLERY_LENGTH,
	TASTING_NAME_LENGTH,
	TASTING_SCALE,
	TASTING_WHISKYBASE_URL_LENGTH
} from '../../validation';

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	// Whitelist + profile fields live directly on the Better Auth user table
	// (no separate whitelist table): a row here means the address may log in.
	username: text('username').notNull().unique(),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	// Set instead of deleting a user who took part in a tasting (their
	// participations must stay). A deactivated user can't log in; email and
	// username stay taken.
	deactivatedAt: integer('deactivated_at', { mode: 'timestamp' })
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	// Cascade so deleting a user from the admin page kills all their sessions
	// (forced logout on next request).
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
});

export const account = sqliteTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
});

// Backs Better Auth's built-in rate limiter (storage: 'database').
export const rateLimit = sqliteTable('rate_limit', {
	id: text('id').primaryKey(),
	key: text('key'),
	count: integer('count'),
	lastRequest: integer('last_request')
});

// Per-email throttle for magic-link requests. Better Auth's built-in rate
// limiter only buckets per IP+path, so flooding a single mailbox from rotating
// IPs would slip through. One row per email, rolling fixed window.
export const magicLinkThrottle = sqliteTable('magic_link_throttle', {
	email: text('email').primaryKey(),
	count: integer('count').notNull(),
	windowStart: integer('window_start', { mode: 'timestamp' }).notNull()
});

// ── Whisky tasting ──────────────────────────────────────────────────────────
// CHECK constraints are the second line of defence behind the server-side
// validation; their bounds come from the shared constants in validation.ts.
// The bounds must be inlined via sql.raw(): as regular template parameters
// drizzle-kit would write `?` placeholders into the generated migration.
// Nullable columns pass automatically (NULL BETWEEN … is not false).

function inRange(column: SQLiteColumn, min: number, max: number): SQL {
	return sql`${column} BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}`;
}

function lengthUpTo(column: SQLiteColumn, max: number): SQL {
	return sql`length(${column}) BETWEEN 1 AND ${sql.raw(String(max))}`;
}

// An archived bottle has none of the factors, every other bottle all of them.
function factorsMatchArchived(archived: SQLiteColumn, factors: SQLiteColumn[]): SQL {
	const all = (condition: string) =>
		sql.join(
			factors.map((factor) => sql`${factor} ${sql.raw(condition)}`),
			sql` AND `
		);
	return sql`(${archived} = 0 AND ${all('IS NOT NULL')}) OR (${archived} = 1 AND ${all('IS NULL')})`;
}

// The tasting date is a calendar date (YYYY-MM-DD), not a timestamp: the
// phases hang on Berlin local time, not on an instant.
export const tasting = sqliteTable(
	'tasting',
	{
		id: text('id').primaryKey(),
		// The tasting's one link /tasting/<adjective>-<animal>, picked at random
		// from the free combinations on creation and never changed. Not a
		// secret: login plus participation protect the page.
		slug: text('slug').notNull().unique(),
		name: text('name').notNull(),
		tastingDate: text('tasting_date').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		// Admin overrides of the 18:00 / 9:00 rules; null = the clock decides.
		// Every participant sees when the admin pressed the button.
		orderOpenedAt: integer('order_opened_at', { mode: 'timestamp' }),
		revealedAt: integer('revealed_at', { mode: 'timestamp' }),
		// Optional, null = no motto. Deliberately no CHECK on its length (the
		// actions validate it), for the same reason as presentation_name below:
		// a CHECK on an existing table makes drizzle-kit rebuild it.
		motto: text('motto')
	},
	(t) => [check('tasting_name_length', lengthUpTo(t.name, TASTING_NAME_LENGTH.max))]
);

// Word lists for the tasting links /tasting/<adjective>-<animal>, seeded by a
// migration (drizzle/0005_*.sql). Lower-case a–z only, so the hyphen is an
// unambiguous separator (TASTING_SLUG_RE in validation.ts).
export const tastingSlugAdjective = sqliteTable('tasting_slug_adjective', {
	word: text('word').primaryKey()
});

export const tastingSlugAnimal = sqliteTable('tasting_slug_animal', {
	word: text('word').primaryKey()
});

// A user taking part in a tasting. ON DELETE restrict: a user with a
// participation is deactivated instead of deleted (admin page), so their
// bottles stay in the order and the reveal.
export const tastingParticipant = sqliteTable(
	'tasting_participant',
	{
		id: text('id').primaryKey(),
		tastingId: text('tasting_id')
			.notNull()
			.references(() => tasting.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [uniqueIndex('tasting_participant_tasting_user_unique').on(t.tastingId, t.userId)]
);

// No tasting_id here: the tasting is reached via the participant.
export const tastingBottle = sqliteTable(
	'tasting_bottle',
	{
		id: text('id').primaryKey(),
		participantId: text('participant_id')
			.notNull()
			.references(() => tastingParticipant.id, { onDelete: 'cascade' }),
		slot: integer('slot').notNull(),
		alias: text('alias').notNull(),
		distillery: text('distillery').notNull(),
		bottler: text('bottler'),
		bottling: text('bottling'),
		age: integer('age'),
		whiskybaseUrl: text('whiskybase_url'),
		smoke: integer('smoke'),
		cask: integer('cask'),
		abv: real('abv').notNull(),
		value: integer('value'),
		// Imported from the tasting history with the ABV only: an archived bottle
		// has no smoke, cask and value, every other bottle has all three
		// (CHECK tasting_bottle_archived_factors). Only the import sets the flag.
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
		// Optional presentation upload: the file name in MEDIA_PATH follows the
		// scheme Tasting_<date>_<alias>[.ext] (presentationFiles.ts, never the
		// client's file name); the original name is kept for display and as
		// download name.
		presentationFile: text('presentation_file'),
		presentationName: text('presentation_name')
	},
	(t) => [
		uniqueIndex('tasting_bottle_participant_slot_unique').on(t.participantId, t.slot),
		check('tasting_bottle_slot_range', inRange(t.slot, 1, TASTING_BOTTLE_SLOTS.max)),
		check('tasting_bottle_alias_length', lengthUpTo(t.alias, TASTING_ALIAS_LENGTH.max)),
		check(
			'tasting_bottle_distillery_length',
			lengthUpTo(t.distillery, TASTING_DISTILLERY_LENGTH.max)
		),
		check('tasting_bottle_bottler_length', lengthUpTo(t.bottler, TASTING_BOTTLER_LENGTH.max)),
		check('tasting_bottle_bottling_length', lengthUpTo(t.bottling, TASTING_BOTTLING_LENGTH.max)),
		check('tasting_bottle_age_range', inRange(t.age, TASTING_AGE.min, TASTING_AGE.max)),
		check(
			'tasting_bottle_whiskybase_url_length',
			lengthUpTo(t.whiskybaseUrl, TASTING_WHISKYBASE_URL_LENGTH.max)
		),
		check('tasting_bottle_smoke_range', inRange(t.smoke, TASTING_SCALE.min, TASTING_SCALE.max)),
		check('tasting_bottle_cask_range', inRange(t.cask, TASTING_SCALE.min, TASTING_SCALE.max)),
		check('tasting_bottle_abv_range', inRange(t.abv, TASTING_ABV.min, TASTING_ABV.max)),
		check('tasting_bottle_value_range', inRange(t.value, TASTING_SCALE.min, TASTING_SCALE.max)),
		check(
			'tasting_bottle_archived_factors',
			factorsMatchArchived(t.archived, [t.smoke, t.cask, t.value])
		)
		// Deliberately no CHECK on presentation_name (length is validated in the
		// save action): adding a CHECK to an existing table makes drizzle-kit
		// rebuild the table, and its generated INSERT … SELECT reads the new
		// columns from the old table, which breaks the migration.
	]
);

// Per-participant write limit on the save action, analogous to
// magic_link_throttle: one row per participant, rolling fixed window.
export const tastingWriteThrottle = sqliteTable('tasting_write_throttle', {
	participantId: text('participant_id')
		.primaryKey()
		.references(() => tastingParticipant.id, { onDelete: 'cascade' }),
	count: integer('count').notNull(),
	windowStart: integer('window_start', { mode: 'timestamp' }).notNull()
});

// One-off background jobs after a deployment (startupJobs.ts): one row per job
// that ever ran, none while it is pending. Shown on the admin page.
export const startupJob = sqliteTable(
	'startup_job',
	{
		id: text('id').primaryKey(),
		status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
		startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
		finishedAt: integer('finished_at', { mode: 'timestamp' }),
		// The job's summary or a text safe to show, never an internal error.
		message: text('message'),
		progressDone: integer('progress_done'),
		progressTotal: integer('progress_total')
	},
	(t) => [check('startup_job_status', sql`${t.status} IN ('running', 'succeeded', 'failed')`)]
);

// ── Distilleries ────────────────────────────────────────────────────────────
// Facts per distillery, researched by the Claude API (distilleryResearch.ts),
// imported with the history or set by the admin. Linked to the bottles only by
// nameKey(tasting_bottle.distillery) = name_key, computed in JS – no foreign
// key, the bottle keeps its free text (see CLAUDE.md, Destillerie-Recherche).

// String constants only (states, regions): quoted for an inline IN list.
function inList(column: SQLiteColumn, values: readonly string[]): SQL {
	return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
}

// Per value: the state from the list, a value exactly for `found`/`admin`,
// source and rules hash only for `found` (the admin's value has none).
function factChecks(
	name: string,
	value: SQLiteColumn,
	state: SQLiteColumn,
	source: SQLiteColumn,
	rules: SQLiteColumn
) {
	return [
		check(`distillery_${name}_state`, inList(state, DISTILLERY_VALUE_STATES)),
		check(
			`distillery_${name}_value_state`,
			sql`(${value} IS NOT NULL) = (${state} IN ('found', 'admin'))`
		),
		check(
			`distillery_${name}_source_state`,
			sql`(${source} IS NULL AND ${rules} IS NULL) OR ${state} = 'found'`
		),
		check(`distillery_${name}_source_length`, lengthUpTo(source, DISTILLERY_SOURCE_LENGTH.max))
	];
}

// No row means "never researched" for all values. A row appears with the
// first successful research or the history import.
export const distillery = sqliteTable(
	'distillery',
	{
		nameKey: text('name_key').primaryKey(),
		country: text('country'),
		countryState: text('country_state', { enum: DISTILLERY_VALUE_STATES })
			.notNull()
			.default('pending'),
		countrySource: text('country_source'),
		// Short hash of the research rules that found the value, null when imported.
		countryRules: text('country_rules'),
		region: text('region', { enum: SCOTTISH_REGIONS }),
		regionState: text('region_state', { enum: DISTILLERY_VALUE_STATES })
			.notNull()
			.default('pending'),
		regionSource: text('region_source'),
		regionRules: text('region_rules'),
		capacity: integer('capacity'),
		capacityState: text('capacity_state', { enum: DISTILLERY_VALUE_STATES })
			.notNull()
			.default('pending'),
		capacitySource: text('capacity_source'),
		capacityRules: text('capacity_rules'),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [
		...factChecks('country', t.country, t.countryState, t.countrySource, t.countryRules),
		...factChecks('region', t.region, t.regionState, t.regionSource, t.regionRules),
		...factChecks('capacity', t.capacity, t.capacityState, t.capacitySource, t.capacityRules),
		check('distillery_country_length', lengthUpTo(t.country, DISTILLERY_COUNTRY_LENGTH.max)),
		check('distillery_region_list', inList(t.region, SCOTTISH_REGIONS)),
		check(
			'distillery_region_country',
			sql`${t.region} IS NULL OR ${t.country} = '${sql.raw(SCOTLAND)}'`
		),
		check(
			'distillery_capacity_range',
			inRange(t.capacity, DISTILLERY_CAPACITY.min, DISTILLERY_CAPACITY.max)
		)
	]
);

// One row per API response of the research, also per continuation after
// pause_turn and also without a result: the costs count in any case. Linked
// by name_key instead of a foreign key, as a call may have no distillery row.
export const distilleryResearchCall = sqliteTable(
	'distillery_research_call',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		nameKey: text('name_key').notNull(),
		stage: integer('stage').notNull(),
		model: text('model').notNull(),
		inputTokens: integer('input_tokens').notNull(),
		outputTokens: integer('output_tokens').notNull(),
		cacheCreationInputTokens: integer('cache_creation_input_tokens').notNull(),
		cacheReadInputTokens: integer('cache_read_input_tokens').notNull(),
		webSearchRequests: integer('web_search_requests').notNull(),
		webFetchRequests: integer('web_fetch_requests').notNull(),
		// Whole micro-dollars at the prices of the call: sums without float noise,
		// a later price change leaves old amounts alone.
		costMicroUsd: integer('cost_micro_usd').notNull()
	},
	(t) => [
		index('distillery_research_call_name_key').on(t.nameKey),
		check('distillery_research_call_stage', sql`${t.stage} IN (1, 2)`)
	]
);

// Key-value settings of the app. No row means the default.
export const appSetting = sqliteTable('app_setting', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
