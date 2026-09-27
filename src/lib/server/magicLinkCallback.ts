import { eq } from 'drizzle-orm';
import { user as userTable, magicLinkThrottle } from './db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import type { ThrottleOptions } from './magicLinkThrottle';

// `user` backs the whitelist SELECT below; `magicLinkThrottle` is only listed so
// this db handle also satisfies the injected consumeEmailRateLimit signature.
type Schema = { user: typeof userTable; magicLinkThrottle: typeof magicLinkThrottle };
type Db = BetterSQLite3Database<Schema>;

/**
 * Everything the callback would otherwise reach for via module scope. Injected
 * so the security-critical branches below are unit-testable without a real DB
 * handle, SMTP transport or filesystem (see magicLinkCallback.test.ts).
 */
export type MagicLinkCallbackDeps = {
	db: Db;
	consumeEmailRateLimit: (db: Db, email: string, opts: ThrottleOptions, now?: Date) => boolean;
	emailRateLimit: ThrottleOptions;
	sendMagicLinkMail: (email: string, url: string) => Promise<void>;
	dev: boolean;
	magicLinkDebugPath: string | undefined;
	logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
	/** Appends the magic-link URL to the test-only capture file. */
	appendFile: (path: string, data: string) => void;
};

/**
 * Better Auth's `sendMagicLink` callback, extracted from the betterAuth(...)
 * config so it can be unit-tested (auth.ts itself is coverage-excluded wiring).
 *
 * The branch order and the missing `await` on the mail send are deliberate
 * anti-enumeration measures – see the inline comments. Any change here needs a
 * matching test in magicLinkCallback.test.ts.
 */
export async function handleSendMagicLink(
	rawEmail: string,
	url: string,
	deps: MagicLinkCallbackDeps
): Promise<void> {
	const { db, emailRateLimit, dev, magicLinkDebugPath, logger } = deps;

	// Stored addresses are always lowercased (admin bootstrap + admin page),
	// and Better Auth looks users up case-insensitively at verify time. Match
	// that here so the whitelist gate is not stricter than the actual login.
	const email = rawEmail.trim().toLowerCase();

	// Per-email throttle (3/h) on top of Better Auth's per-IP rule. Runs for
	// every request, before the whitelist branch, so hit and miss share the
	// same code path and an over-quota request behaves exactly like a miss
	// (no mail, identical response) – no enumeration oracle.
	const allowed = deps.consumeEmailRateLimit(db, email, emailRateLimit);

	// Whitelist enforcement: Better Auth would otherwise send a link to any
	// address. Only registered users (a row in `user`) get a mail. The
	// expensive token generation already happened identically for hit and
	// miss before this callback runs, so an indexed SELECT here does not
	// create a timing oracle for enumeration.
	const exists = db
		.select({ id: userTable.id })
		.from(userTable)
		.where(eq(userTable.email, email))
		.get();

	if (!exists) {
		logger.debug({ email }, 'magic link requested for non-whitelisted email (ignored)');
		return;
	}

	if (!allowed) {
		logger.warn({ email }, 'magic link rate limit exceeded for email (ignored)');
		return;
	}

	if (dev) {
		logger.info({ email, url }, 'magic link (dev console only, no SMTP)');
		return;
	}

	if (magicLinkDebugPath) {
		try {
			deps.appendFile(magicLinkDebugPath, url + '\n');
		} catch (err) {
			logger.error({ err }, 'failed to write magic link debug file');
		}
		return;
	}

	// Fire-and-forget: SMTP latency must not gate the auth response,
	// otherwise timing differences leak whitelist membership.
	deps.sendMagicLinkMail(email, url).catch((err) => {
		logger.error({ err, email }, 'failed to send magic link email');
	});
}
