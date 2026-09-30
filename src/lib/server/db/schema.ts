import { sql, type SQL } from 'drizzle-orm';
import {
	sqliteTable,
	text,
	integer,
	real,
	check,
	uniqueIndex,
	type SQLiteColumn
} from 'drizzle-orm/sqlite-core';
// Relative import on purpose: drizzle-kit loads this file outside of Vite and
// doesn't know the $lib alias.
import {
	TASTING_ABV,
	TASTING_AGE,
	TASTING_ALIAS_LENGTH,
	TASTING_BOTTLER_LENGTH,
	TASTING_BOTTLES_PER_PARTICIPANT,
	TASTING_BOTTLING_LENGTH,
	TASTING_DISTILLERY_LENGTH,
	TASTING_NAME_LENGTH,
	TASTING_PARTICIPANT_NAME_LENGTH,
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
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false)
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

// The tasting date is a calendar date (YYYY-MM-DD), not a timestamp: the
// phases hang on Berlin local time, not on an instant.
export const tasting = sqliteTable(
	'tasting',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		tastingDate: text('tasting_date').notNull(),
		bottlesPerParticipant: integer('bottles_per_participant').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		// Admin overrides of the 18:00 / 9:00 rules; null = the clock decides.
		// Every link shows when the admin pressed the button.
		orderOpenedAt: integer('order_opened_at', { mode: 'timestamp' }),
		revealedAt: integer('revealed_at', { mode: 'timestamp' })
	},
	(t) => [
		check('tasting_name_length', lengthUpTo(t.name, TASTING_NAME_LENGTH.max)),
		check(
			'tasting_bottles_per_participant_range',
			inRange(
				t.bottlesPerParticipant,
				TASTING_BOTTLES_PER_PARTICIPANT.min,
				TASTING_BOTTLES_PER_PARTICIPANT.max
			)
		)
	]
);

// Only the SHA-256 hash of the link token is stored: links never expire, so a
// DB backup must not contain usable links, and the admin must not be able to
// open other participants' links later on.
export const tastingParticipant = sqliteTable(
	'tasting_participant',
	{
		id: text('id').primaryKey(),
		tastingId: text('tasting_id')
			.notNull()
			.references(() => tasting.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [
		check(
			'tasting_participant_name_length',
			lengthUpTo(t.name, TASTING_PARTICIPANT_NAME_LENGTH.max)
		)
	]
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
		smoke: integer('smoke').notNull(),
		cask: integer('cask').notNull(),
		abv: real('abv').notNull(),
		value: integer('value').notNull(),
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
		check('tasting_bottle_slot_range', inRange(t.slot, 1, TASTING_BOTTLES_PER_PARTICIPANT.max)),
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
		check('tasting_bottle_value_range', inRange(t.value, TASTING_SCALE.min, TASTING_SCALE.max))
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

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
