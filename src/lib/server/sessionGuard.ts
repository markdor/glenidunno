import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { user as userTable } from './db/schema';

type Schema = { user: typeof userTable };
type Db = BetterSQLite3Database<Schema>;

/**
 * Whether Better Auth may create a session for the user, wired as
 * `databaseHooks.session.create.before` in auth.ts (coverage-excluded wiring;
 * the decision lives here). A deactivated user gets none – which also voids a
 * magic link sent before the deactivation (valid for 24 h): the verify
 * endpoint then redirects with `error=failed_to_create_session`, which the
 * login page shows like any other failed link.
 */
export function canStartSession(db: Db, userId: string): boolean {
	const row = db
		.select({ deactivatedAt: userTable.deactivatedAt })
		.from(userTable)
		.where(eq(userTable.id, userId))
		.get();
	return row !== undefined && row.deactivatedAt === null;
}
