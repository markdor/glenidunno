import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/**
 * Applies all pending migrations with foreign keys switched off, then checks
 * them and switches them back on – SQLite's documented procedure for schema
 * changes.
 *
 * Drizzle runs every pending migration inside a single BEGIN … COMMIT, where
 * the `PRAGMA foreign_keys=OFF` that drizzle-kit writes around a table rebuild
 * is a no-op. With foreign keys on, the rebuild's DROP TABLE would cascade and
 * silently delete every row hanging on the rebuilt table (e.g. all bottles of
 * tasting_participant). The pragma only takes effect outside a transaction,
 * so it is set here, before migrate().
 *
 * Throws if the migrated data violates a foreign key; the app must not start
 * on such a database (the migrations are committed by then – restore the
 * backup taken before the deploy).
 */
export function runMigrations(sqlite: Database.Database, migrationsFolder: string): void {
	sqlite.pragma('foreign_keys = OFF');
	try {
		migrate(drizzle(sqlite), { migrationsFolder });
		const violations = sqlite.pragma('foreign_key_check') as Array<{
			table: string;
			rowid: number | null;
			parent: string;
		}>;
		if (violations.length > 0) {
			const sample = violations
				.slice(0, 5)
				.map((v) => `${v.table}#${v.rowid} → ${v.parent}`)
				.join(', ');
			throw new Error(
				`foreign key check failed after migrations: ${violations.length} violation(s), e.g. ${sample}`
			);
		}
	} finally {
		sqlite.pragma('foreign_keys = ON');
	}
}
