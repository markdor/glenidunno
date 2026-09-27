import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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
	// Optional – users without bot access are allowed.
	telegramUserId: text('telegram_user_id').unique()
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

// Exactly one active bot token at a time (single row). We store only the
// SHA-256 hash of the token; the plaintext is shown once in the admin UI.
export const botToken = sqliteTable('bot_token', {
	id: text('id').primaryKey(),
	tokenHash: text('token_hash').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	lastUsedAt: integer('last_used_at', { mode: 'timestamp' })
});

// Per-email throttle for magic-link requests. Better Auth's built-in rate
// limiter only buckets per IP+path, so flooding a single mailbox from rotating
// IPs would slip through. One row per email, rolling fixed window.
export const magicLinkThrottle = sqliteTable('magic_link_throttle', {
	email: text('email').primaryKey(),
	count: integer('count').notNull(),
	windowStart: integer('window_start', { mode: 'timestamp' }).notNull()
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type BotToken = typeof botToken.$inferSelect;
