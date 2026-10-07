import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';

import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import { consumeEmailRateLimit, type ThrottleOptions } from './magicLinkThrottle';
import { handleSendMagicLink, type MagicLinkCallbackDeps } from './magicLinkCallback';

let db: BetterSQLite3Database<typeof schema>;

const OPTS: ThrottleOptions = { max: 3, windowMs: 60 * 60 * 1000 };
const EMAIL = 'user@example.com';
const LINK = 'https://glenidunno.test/auth/magic-link/verify?token=abc';

const sendMagicLinkMail = vi.fn<(email: string, url: string) => Promise<void>>();
const appendFile = vi.fn<(path: string, data: string) => void>();
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** An active row in `user` is what makes an address whitelisted for login. */
function whitelist(email: string, deactivatedAt: Date | null = null): void {
	db.insert(schema.user)
		.values({
			id: randomUUID(),
			name: 'Test User',
			email,
			emailVerified: true,
			username: `user-${randomUUID().slice(0, 8)}`,
			isAdmin: false,
			deactivatedAt,
			createdAt: new Date(),
			updatedAt: new Date()
		})
		.run();
}

/** Defaults describe the production path (not dev, no debug file, quota free). */
function makeDeps(overrides: Partial<MagicLinkCallbackDeps> = {}): MagicLinkCallbackDeps {
	return {
		db,
		consumeEmailRateLimit: vi.fn(() => true),
		emailRateLimit: OPTS,
		sendMagicLinkMail,
		dev: false,
		magicLinkDebugPath: undefined,
		logger,
		appendFile,
		...overrides
	};
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });

	vi.clearAllMocks();
	sendMagicLinkMail.mockImplementation(async () => {});
});

describe('handleSendMagicLink', () => {
	describe('no mail leaves the building unless the request is legitimate', () => {
		it('sends no mail for an address that is not whitelisted', async () => {
			// No user row for EMAIL -> whitelist miss.
			await handleSendMagicLink(EMAIL, LINK, makeDeps());

			expect(sendMagicLinkMail).not.toHaveBeenCalled();
			expect(appendFile).not.toHaveBeenCalled();
			expect(logger.debug).toHaveBeenCalledWith(
				{ email: EMAIL },
				'magic link requested for non-whitelisted email (ignored)'
			);
		});

		it('treats a deactivated user exactly like an address that is not whitelisted', async () => {
			whitelist(EMAIL, new Date());
			const consume = vi.fn(() => true);

			await handleSendMagicLink(EMAIL, LINK, makeDeps({ consumeEmailRateLimit: consume }));

			expect(sendMagicLinkMail).not.toHaveBeenCalled();
			expect(appendFile).not.toHaveBeenCalled();
			// Same branch as a miss: quota consumed, same debug log, nothing else.
			expect(consume).toHaveBeenCalledOnce();
			expect(logger.debug).toHaveBeenCalledWith(
				{ email: EMAIL },
				'magic link requested for non-whitelisted email (ignored)'
			);
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it('sends no mail once the email has exhausted its rate limit', async () => {
			whitelist(EMAIL);

			await handleSendMagicLink(EMAIL, LINK, makeDeps({ consumeEmailRateLimit: () => false }));

			expect(sendMagicLinkMail).not.toHaveBeenCalled();
			expect(logger.warn).toHaveBeenCalledWith(
				{ email: EMAIL },
				'magic link rate limit exceeded for email (ignored)'
			);
		});
	});

	describe('anti-enumeration properties', () => {
		it('returns before the mail is actually sent (fire-and-forget)', async () => {
			// A real send takes 200-2000ms of SMTP latency. If the callback awaited
			// it, the response time would leak whitelist membership – so the mail
			// promise must still be pending when the callback resolves.
			const order: string[] = [];
			let releaseMail!: () => void;
			const mailGate = new Promise<void>((resolve) => {
				releaseMail = resolve;
			});
			sendMagicLinkMail.mockImplementation(async () => {
				await mailGate;
				order.push('mail');
			});
			whitelist(EMAIL);

			await handleSendMagicLink(EMAIL, LINK, makeDeps());
			order.push('callback');

			expect(sendMagicLinkMail).toHaveBeenCalledWith(EMAIL, LINK);
			// The callback already resolved while the mail is still in flight.
			expect(order).toEqual(['callback']);

			releaseMail();
			await vi.waitFor(() => expect(order).toEqual(['callback', 'mail']));
		});

		it('consumes the rate limit for every request, including a whitelist miss', async () => {
			// Regression guard for the branch order: throttling happens before the
			// whitelist check, so probing unknown addresses burns quota just like a
			// hit does and cannot be used to enumerate the whitelist.
			const opts: ThrottleOptions = { max: 2, windowMs: 60 * 60 * 1000 };
			const unknown = 'stranger@example.com';
			const deps = makeDeps({ consumeEmailRateLimit, emailRateLimit: opts });

			await handleSendMagicLink(unknown, LINK, deps);
			await handleSendMagicLink(unknown, LINK, deps);

			expect(sendMagicLinkMail).not.toHaveBeenCalled();
			// Both misses were counted – the quota is gone.
			expect(consumeEmailRateLimit(db, unknown, opts)).toBe(false);
		});

		it('normalises the address before the whitelist lookup', async () => {
			whitelist('user@ex.de');

			await handleSendMagicLink('  User@Ex.DE  ', LINK, makeDeps());

			expect(sendMagicLinkMail).toHaveBeenCalledWith('user@ex.de', LINK);
		});
	});

	describe('non-SMTP delivery paths', () => {
		it('only logs the link in dev instead of sending it', async () => {
			whitelist(EMAIL);

			await handleSendMagicLink(EMAIL, LINK, makeDeps({ dev: true }));

			expect(logger.info).toHaveBeenCalledWith(
				{ email: EMAIL, url: LINK },
				'magic link (dev console only, no SMTP)'
			);
			expect(sendMagicLinkMail).not.toHaveBeenCalled();
			expect(appendFile).not.toHaveBeenCalled();
		});

		it('writes to the capture file instead of sending when the debug path is set', async () => {
			whitelist(EMAIL);

			await handleSendMagicLink(EMAIL, LINK, makeDeps({ magicLinkDebugPath: '/tmp/capture.log' }));

			expect(appendFile).toHaveBeenCalledWith('/tmp/capture.log', LINK + '\n');
			expect(sendMagicLinkMail).not.toHaveBeenCalled();
		});
	});

	describe('delivery failures stay internal', () => {
		it('logs but does not throw when the capture file cannot be written', async () => {
			whitelist(EMAIL);
			appendFile.mockImplementation(() => {
				throw new Error('EACCES');
			});

			await expect(
				handleSendMagicLink(EMAIL, LINK, makeDeps({ magicLinkDebugPath: '/tmp/capture.log' }))
			).resolves.toBeUndefined();

			expect(logger.error).toHaveBeenCalledWith(
				{ err: expect.any(Error) },
				'failed to write magic link debug file'
			);
		});

		it('logs a rejected mail send without surfacing it to the caller', async () => {
			const err = new Error('smtp down');
			sendMagicLinkMail.mockRejectedValue(err);
			whitelist(EMAIL);

			await expect(handleSendMagicLink(EMAIL, LINK, makeDeps())).resolves.toBeUndefined();

			await vi.waitFor(() =>
				expect(logger.error).toHaveBeenCalledWith(
					{ err, email: EMAIL },
					'failed to send magic link email'
				)
			);
		});
	});
});
