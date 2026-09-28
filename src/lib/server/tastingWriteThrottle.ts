import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { tastingWriteThrottle } from './db/schema';
import type { ThrottleOptions } from './magicLinkThrottle';

type Schema = { tastingWriteThrottle: typeof tastingWriteThrottle };
type Db = BetterSQLite3Database<Schema>;

// Save actions per participant link (starting value, tunable). Deliberately
// no per-IP limit: 192-bit tokens can't be guessed, and without ADDRESS_HEADER
// getClientAddress() only sees Traefik's IP, so all participants would share
// one bucket.
export const TASTING_WRITE_LIMIT: ThrottleOptions = {
	max: 30,
	windowMs: 10 * 60 * 1000
};

/**
 * Rolling fixed-window counter per participant, persisted in SQLite (same
 * scheme as consumeEmailRateLimit). Returns true if the save is within the
 * limit (and records it), false once the quota of the window is used up.
 */
export function consumeTastingWriteLimit(
	db: Db,
	participantId: string,
	opts: ThrottleOptions = TASTING_WRITE_LIMIT,
	now: Date = new Date()
): boolean {
	const row = db
		.select()
		.from(tastingWriteThrottle)
		.where(eq(tastingWriteThrottle.participantId, participantId))
		.get();

	// No prior record, or the previous window has fully elapsed → start fresh.
	if (!row || now.getTime() - row.windowStart.getTime() > opts.windowMs) {
		db.insert(tastingWriteThrottle)
			.values({ participantId, count: 1, windowStart: now })
			.onConflictDoUpdate({
				target: tastingWriteThrottle.participantId,
				set: { count: 1, windowStart: now }
			})
			.run();
		return true;
	}

	if (row.count >= opts.max) return false;

	db.update(tastingWriteThrottle)
		.set({ count: row.count + 1 })
		.where(eq(tastingWriteThrottle.participantId, participantId))
		.run();
	return true;
}
