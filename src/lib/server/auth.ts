import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { appendFileSync } from 'node:fs';
import { db } from './db';
import { logger } from './logger';
import { sendMagicLinkMail } from './mailer';
import { handleSendMagicLink } from './magicLinkCallback';
import { consumeEmailRateLimit, MAGIC_LINK_EMAIL_LIMIT } from './magicLinkThrottle';
import { canStartSession } from './sessionGuard';

const baseURL = env.BASE_URL ?? 'http://localhost:5173';

// Fail fast instead of silently signing cookies and tokens with a public,
// well-known fallback secret. In dev the placeholder is fine; in production a
// missing secret is a hard configuration error. The `building` guard keeps this
// from firing during `vite build` (where env vars are deliberately absent) – it
// must only break at actual server startup, not at build time.
if (!env.AUTH_SECRET && !dev && !building) {
	throw new Error('AUTH_SECRET must be set in production');
}
const secret = env.AUTH_SECRET ?? 'dev-secret-do-not-use-in-production';

// Test-only seam: with hashed token storage the plaintext token lives only in
// the email URL, so an e2e harness running a production build (no dev console
// log, no SMTP) can't recover it from the DB. When this path is set we append
// the magic-link URL to it. Off by default; scream if it is ever set in prod.
const magicLinkDebugPath = env.MAGIC_LINK_DEBUG_PATH;
if (magicLinkDebugPath && !dev) {
	logger.warn(
		'MAGIC_LINK_DEBUG_PATH is set outside dev – magic-link URLs are being written to disk. ' +
			'This is a test-only affordance and must never be enabled in production.'
	);
}

// E2E test harnesses re-request a magic link on every run (Playwright UI mode
// alone does this dozens of times per debugging session) against the same
// shared "no-trusted-ip" bucket – a local vite-preview/docker run never has a
// real client IP for Better Auth to key the limiter on. Raise both limiters
// far above anything reachable in production traffic instead of disabling
// them, so the real rate-limit code path still runs. Gated on the same
// MAGIC_LINK_DEBUG_PATH seam as the file capture above.
const magicLinkRateLimit = magicLinkDebugPath
	? { window: 15 * 60, max: 1000 }
	: { window: 15 * 60, max: 5 };

// The per-email ceiling stays deliberately low (unlike the per-IP one above):
// an e2e case asserts that an over-quota request sends no mail, and it has to
// be able to exhaust this quota with real requests in reasonable time. Still
// well above the handful of logins a debugging session needs.
// Keep in sync with MAGIC_LINK_EMAIL_TEST_LIMIT in tests/e2e/magic-link.ts.
const emailRateLimit = magicLinkDebugPath
	? { ...MAGIC_LINK_EMAIL_LIMIT, max: 20 }
	: MAGIC_LINK_EMAIL_LIMIT;

export const auth = betterAuth({
	// Mounted at /auth instead of Better Auth's default /api/auth; the closed-app
	// guard treats /auth/* as public (see guard.ts).
	basePath: '/auth',
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	secret,
	baseURL,
	trustedOrigins: [baseURL],
	advanced: {
		// Behind Traefik the real client IP arrives in X-Forwarded-For; without
		// this the rate limiter would bucket every request under the proxy IP.
		ipAddress: {
			ipAddressHeaders: ['x-forwarded-for', 'x-real-ip']
		}
	},
	user: {
		additionalFields: {
			username: { type: 'string', required: true, input: false },
			isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false }
		}
	},
	session: {
		expiresIn: 60 * 60 * 24 * 30, // 30 days
		updateAge: 60 * 60 * 24
	},
	databaseHooks: {
		session: {
			create: {
				// false aborts the creation: no new session for a deactivated user,
				// not even from a magic link sent before the deactivation. The
				// decision lives in sessionGuard.ts (unit-tested).
				before: async (newSession) => canStartSession(db, newSession.userId)
			}
		}
	},
	// Built-in rate limiter, persisted in the same SQLite DB (no extra storage).
	rateLimit: {
		enabled: true,
		storage: 'database',
		modelName: 'rateLimit',
		window: 10,
		max: 10, // default for all auth routes: 10 req / 10 s
		customRules: {
			'/sign-in/magic-link': magicLinkRateLimit // 5 req / 15 min per IP in prod
		}
	},
	plugins: [
		magicLink({
			// Better Auth never creates users itself – the only way into the user
			// table is the admin bootstrap or the admin page.
			disableSignUp: true,
			// Persist only a hash of the link token, not the plaintext, so a DB
			// read does not hand out usable 24h logins.
			storeToken: 'hashed',
			expiresIn: 60 * 60 * 24, // link valid for 24 hours
			// The whitelist gate, the per-email throttle and the deliberately
			// un-awaited mail send live in magicLinkCallback.ts – this module is
			// coverage-excluded wiring, that one is unit-tested.
			sendMagicLink: async ({ email, url }) =>
				handleSendMagicLink(email, url, {
					db,
					consumeEmailRateLimit,
					emailRateLimit,
					sendMagicLinkMail,
					dev,
					magicLinkDebugPath,
					logger,
					appendFile: appendFileSync
				})
		}),
		sveltekitCookies(getRequestEvent)
	]
});

export type Auth = typeof auth;
