import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import type { ThrottleOptions } from './magicLinkThrottle';
import { consumeTastingWriteLimit, TASTING_WRITE_LIMIT } from './tastingWriteThrottle';

let db: BetterSQLite3Database<typeof schema>;

const OPTS: ThrottleOptions = { max: 3, windowMs: 10 * 60 * 1000 };
const START = new Date('2026-10-20T10:00:00Z');

function addParticipant(id: string) {
	db.insert(schema.user)
		.values({
			id: `u-${id}`,
			name: id,
			email: `${id}@example.com`,
			username: id,
			createdAt: START,
			updatedAt: START
		})
		.run();
	db.insert(schema.tastingParticipant)
		.values({ id, tastingId: 't1', userId: `u-${id}`, createdAt: START })
		.run();
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	// Throttle rows reference the participant, so the FK must really be
	// enforced – runMigrations() leaves foreign keys switched on.
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	db.insert(schema.tasting)
		.values({
			id: 't1',
			slug: 'fluffy-otter',
			name: 'Herbst',
			tastingDate: '2026-10-24',
			bottlesPerParticipant: 2,
			createdAt: START
		})
		.run();
	addParticipant('p1');
	addParticipant('p2');
});

describe('consumeTastingWriteLimit', () => {
	it('defaults to 30 saves per 10 minutes', () => {
		expect(TASTING_WRITE_LIMIT).toEqual({ max: 30, windowMs: 10 * 60 * 1000 });
	});

	it('allows saves up to the limit, then blocks within the window', () => {
		expect(consumeTastingWriteLimit(db, 'p1', OPTS, START)).toBe(true);
		expect(consumeTastingWriteLimit(db, 'p1', OPTS, START)).toBe(true);
		expect(consumeTastingWriteLimit(db, 'p1', OPTS, START)).toBe(true);
		expect(consumeTastingWriteLimit(db, 'p1', OPTS, START)).toBe(false);
	});

	it('keeps a separate quota per participant', () => {
		for (let i = 0; i < 3; i++) consumeTastingWriteLimit(db, 'p1', OPTS, START);
		expect(consumeTastingWriteLimit(db, 'p1', OPTS, START)).toBe(false);
		expect(consumeTastingWriteLimit(db, 'p2', OPTS, START)).toBe(true);
	});

	it('starts a fresh window once the old one has elapsed', () => {
		for (let i = 0; i < 3; i++) consumeTastingWriteLimit(db, 'p1', OPTS, START);
		// Exactly at the boundary still counts as the old window.
		expect(
			consumeTastingWriteLimit(db, 'p1', OPTS, new Date(START.getTime() + OPTS.windowMs))
		).toBe(false);
		const later = new Date(START.getTime() + OPTS.windowMs + 1);
		expect(consumeTastingWriteLimit(db, 'p1', OPTS, later)).toBe(true);
		expect(db.select().from(schema.tastingWriteThrottle).all()).toHaveLength(1);
	});

	it('is removed together with the participant', () => {
		consumeTastingWriteLimit(db, 'p1', OPTS, START);
		db.delete(schema.tasting).run();
		expect(db.select().from(schema.tastingWriteThrottle).all()).toEqual([]);
	});
});
