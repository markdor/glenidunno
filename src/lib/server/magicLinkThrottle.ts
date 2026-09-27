import { eq } from 'drizzle-orm';
import { magicLinkThrottle } from './db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

type Schema = { magicLinkThrottle: typeof magicLinkThrottle };
type Db = BetterSQLite3Database<Schema>;

export type ThrottleOptions = {
	/** Max requests allowed inside the window. */
	max: number;
	/** Window length in milliseconds. */
	windowMs: number;
};

// Per CLAUDE.md: 3 magic-link requests per hour and email address. This is the
// second limiter on top of Better Auth's per-IP rule and protects a single
// mailbox from being flooded via rotating IPs.
export const MAGIC_LINK_EMAIL_LIMIT: ThrottleOptions = {
	max: 3,
	windowMs: 60 * 60 * 1000
};

/**
 * Rolling fixed-window counter, keyed by email and persisted in SQLite.
 * Returns true if the request is within the limit (and records it), false if
 * the email has exhausted its quota for the current window.
 *
 * The caller treats a `false` exactly like a whitelist miss – no mail is sent
 * and the HTTP response is unchanged – so this never becomes a timing or
 * status oracle for address enumeration.
 */
export function consumeEmailRateLimit(
	db: Db,
	email: string,
	opts: ThrottleOptions = MAGIC_LINK_EMAIL_LIMIT,
	now: Date = new Date()
): boolean {
	const row = db.select().from(magicLinkThrottle).where(eq(magicLinkThrottle.email, email)).get();

	// No prior record, or the previous window has fully elapsed → start fresh.
	if (!row || now.getTime() - row.windowStart.getTime() > opts.windowMs) {
		db.insert(magicLinkThrottle)
			.values({ email, count: 1, windowStart: now })
			.onConflictDoUpdate({
				target: magicLinkThrottle.email,
				set: { count: 1, windowStart: now }
			})
			.run();
		return true;
	}

	if (row.count >= opts.max) return false;

	db.update(magicLinkThrottle)
		.set({ count: row.count + 1 })
		.where(eq(magicLinkThrottle.email, email))
		.run();
	return true;
}
