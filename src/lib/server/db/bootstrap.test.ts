import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import * as schema from './schema';
import { bootstrapAdmin } from './bootstrap';

let db: BetterSQLite3Database<typeof schema>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
});

describe('bootstrapAdmin', () => {
	it('inserts the admin user when none exists', () => {
		bootstrapAdmin(db, { email: 'admin@test.com', username: 'admin' });
		const row = db.select().from(schema.user).where(eq(schema.user.email, 'admin@test.com')).get();
		expect(row).toMatchObject({
			email: 'admin@test.com',
			username: 'admin',
			isAdmin: true,
			emailVerified: true
		});
	});

	it('is idempotent across repeated runs', () => {
		bootstrapAdmin(db, { email: 'admin@test.com', username: 'admin' });
		const first = db
			.select()
			.from(schema.user)
			.where(eq(schema.user.email, 'admin@test.com'))
			.get();
		bootstrapAdmin(db, { email: 'admin@test.com', username: 'admin' });
		const second = db
			.select()
			.from(schema.user)
			.where(eq(schema.user.email, 'admin@test.com'))
			.get();
		expect(second?.id).toBe(first?.id);
		expect(db.select().from(schema.user).all().length).toBe(1);
	});

	it('promotes an existing non-admin user with the same email to admin', () => {
		db.insert(schema.user)
			.values({
				id: 'existing',
				name: 'Old Name',
				email: 'admin@test.com',
				emailVerified: false,
				username: 'olduser',
				isAdmin: false,
				createdAt: new Date(),
				updatedAt: new Date()
			})
			.run();

		bootstrapAdmin(db, { email: 'admin@test.com', username: 'new-username-ignored' });

		const row = db.select().from(schema.user).where(eq(schema.user.email, 'admin@test.com')).get();
		expect(row?.id).toBe('existing');
		expect(row?.isAdmin).toBe(true);
		// Other fields must not be touched by re-bootstrap.
		expect(row?.username).toBe('olduser');
		expect(row?.name).toBe('Old Name');
		expect(row?.emailVerified).toBe(false);
	});

	it('leaves an already-admin user completely unchanged', () => {
		db.insert(schema.user)
			.values({
				id: 'existing',
				name: 'Already Admin',
				email: 'admin@test.com',
				emailVerified: true,
				username: 'rootadmin',
				isAdmin: true,
				createdAt: new Date(2020, 0, 1),
				updatedAt: new Date(2020, 0, 1)
			})
			.run();

		bootstrapAdmin(db, { email: 'admin@test.com', username: 'somethingelse' });

		const row = db.select().from(schema.user).where(eq(schema.user.email, 'admin@test.com')).get();
		expect(row?.username).toBe('rootadmin');
		expect(row?.name).toBe('Already Admin');
		expect(row?.updatedAt.getFullYear()).toBe(2020);
	});

	it('skips bootstrap when admin env is not configured', () => {
		bootstrapAdmin(db, { email: undefined, username: undefined });
		expect(db.select().from(schema.user).all()).toEqual([]);
	});

	it('lowercases the email to keep upsert stable across casings', () => {
		bootstrapAdmin(db, { email: 'Admin@Test.COM', username: 'admin' });
		bootstrapAdmin(db, { email: 'admin@test.com', username: 'admin' });
		const rows = db.select().from(schema.user).all();
		expect(rows.length).toBe(1);
		expect(rows[0].email).toBe('admin@test.com');
	});
});
