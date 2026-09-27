import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './db/schema';
import { consumeEmailRateLimit, type ThrottleOptions } from './magicLinkThrottle';

let db: BetterSQLite3Database<typeof schema>;

const OPTS: ThrottleOptions = { max: 3, windowMs: 60 * 60 * 1000 };
const EMAIL = 'user@example.com';

beforeEach(() => {
	const sqlite = new Database(':memory:');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
});

describe('consumeEmailRateLimit', () => {
	it('allows requests up to the limit, then blocks within the window', () => {
		const t = new Date('2026-06-23T10:00:00Z');
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, t)).toBe(true);
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, t)).toBe(true);
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, t)).toBe(true);
		// 4th request inside the same hour is rejected.
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, t)).toBe(false);
	});

	it('does not let a blocked email leak across to other addresses', () => {
		const t = new Date('2026-06-23T10:00:00Z');
		consumeEmailRateLimit(db, EMAIL, OPTS, t);
		consumeEmailRateLimit(db, EMAIL, OPTS, t);
		consumeEmailRateLimit(db, EMAIL, OPTS, t);
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, t)).toBe(false);
		// A different mailbox has its own quota.
		expect(consumeEmailRateLimit(db, 'other@example.com', OPTS, t)).toBe(true);
	});

	it('resets once the window has fully elapsed', () => {
		const start = new Date('2026-06-23T10:00:00Z');
		consumeEmailRateLimit(db, EMAIL, OPTS, start);
		consumeEmailRateLimit(db, EMAIL, OPTS, start);
		consumeEmailRateLimit(db, EMAIL, OPTS, start);
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, start)).toBe(false);

		// Just past the window → fresh quota.
		const later = new Date(start.getTime() + OPTS.windowMs + 1);
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, later)).toBe(true);
		expect(db.select().from(schema.magicLinkThrottle).all().length).toBe(1);
	});

	it('keeps a request near the window edge inside the old window', () => {
		const start = new Date('2026-06-23T10:00:00Z');
		consumeEmailRateLimit(db, EMAIL, OPTS, start);
		consumeEmailRateLimit(db, EMAIL, OPTS, start);
		consumeEmailRateLimit(db, EMAIL, OPTS, start);
		// Exactly at the window boundary is still the same window (not > windowMs).
		const edge = new Date(start.getTime() + OPTS.windowMs);
		expect(consumeEmailRateLimit(db, EMAIL, OPTS, edge)).toBe(false);
	});
});
