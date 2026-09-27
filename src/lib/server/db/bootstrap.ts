import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { user } from './schema';
import { logger } from '../logger';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

type Schema = { user: typeof user };
type Db = BetterSQLite3Database<Schema>;

/**
 * Idempotent admin bootstrap:
 *   - upserts on email
 *   - forces isAdmin = true
 *   - leaves all other fields untouched on update
 *
 * Called on every container start so the admin can't accidentally lock
 * themselves out by deleting their own entry from the admin UI.
 */
export function bootstrapAdmin(
	db: Db,
	opts: { email: string | undefined; username: string | undefined }
): void {
	const email = opts.email?.trim().toLowerCase();
	const username = opts.username?.trim();

	if (!email || !username) {
		logger.warn(
			'ADMIN_EMAIL or ADMIN_USERNAME not set – skipping admin bootstrap. ' +
				'No user will be able to log in until configured.'
		);
		return;
	}

	const existing = db.select().from(user).where(eq(user.email, email)).get();
	const now = new Date();

	if (existing) {
		if (!existing.isAdmin) {
			db.update(user).set({ isAdmin: true, updatedAt: now }).where(eq(user.id, existing.id)).run();
			logger.info({ email }, 'admin bootstrap: promoted existing user to admin');
		} else {
			logger.info({ email }, 'admin bootstrap: admin user already present');
		}
		return;
	}

	db.insert(user)
		.values({
			id: randomUUID(),
			name: username,
			email,
			emailVerified: true,
			username,
			isAdmin: true,
			createdAt: now,
			updatedAt: now
		})
		.run();
	logger.info({ email, username }, 'admin bootstrap: inserted admin user');
}
