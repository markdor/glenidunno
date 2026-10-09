import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import { canStartSession } from './sessionGuard';

let db: BetterSQLite3Database<typeof schema>;

function insertUser(id: string, deactivatedAt: Date | null) {
	db.insert(schema.user)
		.values({
			id,
			name: id,
			email: `${id}@example.com`,
			username: id,
			deactivatedAt,
			createdAt: new Date(),
			updatedAt: new Date()
		})
		.run();
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	insertUser('active', null);
	insertUser('gone', new Date('2026-10-01T12:00:00Z'));
});

describe('canStartSession', () => {
	it('lets an active user log in', () => {
		expect(canStartSession(db, 'active')).toBe(true);
	});

	it('refuses a deactivated user – also with a magic link sent before', () => {
		expect(canStartSession(db, 'gone')).toBe(false);
	});

	it('refuses an unknown user', () => {
		expect(canStartSession(db, 'nobody')).toBe(false);
	});
});
