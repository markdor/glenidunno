import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig, SQLiteSyncDialect, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
	TASTING_ABV,
	TASTING_AGE,
	TASTING_ALIAS_LENGTH,
	TASTING_BOTTLES_PER_PARTICIPANT,
	TASTING_SCALE
} from '$lib/validation';
import * as schema from './schema';

const dialect = new SQLiteSyncDialect();

// Rendered like drizzle-kit renders them into the migration.
function checksOf(table: SQLiteTable) {
	return getTableConfig(table).checks.map((c) => ({
		name: c.name,
		...dialect.sqlToQuery(c.value)
	}));
}

describe('foreign keys', () => {
	it.each([
		{ source: 'session', table: schema.session, target: 'user' },
		{ source: 'account', table: schema.account, target: 'user' },
		{ source: 'tasting_participant', table: schema.tastingParticipant, target: 'tasting' },
		{ source: 'tasting_bottle', table: schema.tastingBottle, target: 'tasting_participant' },
		{
			source: 'tasting_write_throttle',
			table: schema.tastingWriteThrottle,
			target: 'tasting_participant'
		}
	])(
		'$source → $target cascades on delete',
		({ table, target }: { table: SQLiteTable; target: string }) => {
			const [fk] = getTableConfig(table).foreignKeys;
			expect(getTableConfig(fk.reference().foreignTable).name).toBe(target);
			expect(fk.onDelete).toBe('cascade');
		}
	);
});

describe('tasting CHECK constraints', () => {
	it('inline their bounds instead of leaving parameter placeholders', () => {
		const checks = [schema.tasting, schema.tastingParticipant, schema.tastingBottle].flatMap(
			checksOf
		);
		expect(checks.length).toBeGreaterThan(0);
		for (const c of checks) {
			expect(c.params, c.name).toEqual([]);
			expect(c.sql, c.name).not.toContain('?');
		}
	});

	it('derive their bounds from the shared constants', () => {
		const sqlByName = Object.fromEntries(
			checksOf(schema.tastingBottle).map((c) => [c.name, c.sql])
		);
		expect(sqlByName).toMatchObject({
			tasting_bottle_alias_length: `length("tasting_bottle"."alias") BETWEEN 1 AND ${TASTING_ALIAS_LENGTH.max}`,
			tasting_bottle_age_range: `"tasting_bottle"."age" BETWEEN ${TASTING_AGE.min} AND ${TASTING_AGE.max}`,
			tasting_bottle_abv_range: `"tasting_bottle"."abv" BETWEEN ${TASTING_ABV.min} AND ${TASTING_ABV.max}`,
			tasting_bottle_smoke_range: `"tasting_bottle"."smoke" BETWEEN ${TASTING_SCALE.min} AND ${TASTING_SCALE.max}`,
			tasting_bottle_slot_range: `"tasting_bottle"."slot" BETWEEN 1 AND ${TASTING_BOTTLES_PER_PARTICIPANT.max}`
		});
	});

	it('declare the (participant, slot) pair unique', () => {
		const [index] = getTableConfig(schema.tastingBottle).indexes;
		expect(index.config).toMatchObject({
			name: 'tasting_bottle_participant_slot_unique',
			unique: true
		});
	});
});

describe('migrated tasting tables', () => {
	let db: BetterSQLite3Database<typeof schema>;

	beforeEach(() => {
		const sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys = ON');
		db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: './drizzle' });
		db.insert(schema.tasting)
			.values({
				id: 't1',
				name: 'Herbst',
				tastingDate: '2026-10-24',
				bottlesPerParticipant: 2,
				createdAt: new Date()
			})
			.run();
		db.insert(schema.tastingParticipant)
			.values({ id: 'p1', tastingId: 't1', name: 'Anna', tokenHash: 'h1', createdAt: new Date() })
			.run();
	});

	function insertBottle(overrides: Partial<typeof schema.tastingBottle.$inferInsert> = {}) {
		db.insert(schema.tastingBottle)
			.values({
				id: 'b1',
				participantId: 'p1',
				slot: 1,
				alias: 'Nebel',
				distillery: 'Ardbeg',
				smoke: 5,
				cask: 2,
				abv: 46.3,
				value: 3,
				updatedAt: new Date(),
				...overrides
			})
			.run();
	}

	it('accepts a bottle with empty optional fields', () => {
		insertBottle();
		expect(db.select().from(schema.tastingBottle).get()).toMatchObject({
			bottler: null,
			age: null,
			abv: 46.3
		});
	});

	it.each([
		{ field: 'smoke', value: TASTING_SCALE.max + 1 },
		{ field: 'abv', value: TASTING_ABV.max + 0.1 },
		{ field: 'age', value: 0 },
		{ field: 'alias', value: '' },
		{ field: 'slot', value: 0 }
	])('rejects $field = $value', ({ field, value }) => {
		expect(() => insertBottle({ [field]: value })).toThrow(/CHECK constraint failed/);
	});

	it('rejects a second bottle in the same slot', () => {
		insertBottle();
		expect(() => insertBottle({ id: 'b2' })).toThrow(/UNIQUE constraint failed/);
	});

	it('cascades a tasting delete to participants and bottles', () => {
		insertBottle();
		db.delete(schema.tasting).run();
		expect(db.select().from(schema.tastingParticipant).all()).toEqual([]);
		expect(db.select().from(schema.tastingBottle).all()).toEqual([]);
	});
});
