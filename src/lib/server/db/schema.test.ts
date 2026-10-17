import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getTableConfig, SQLiteSyncDialect, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
	DISTILLERY_CAPACITY,
	DISTILLERY_COUNTRY_LENGTH,
	DISTILLERY_SOURCE_LENGTH,
	TASTING_ABV,
	TASTING_AGE,
	TASTING_ALIAS_LENGTH,
	TASTING_BOTTLE_SLOTS,
	TASTING_BOTTLING_LENGTH,
	TASTING_DISTILLERY_LENGTH,
	TASTING_SCALE
} from '$lib/validation';
import { runMigrations } from './migrate';
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
			const fk = getTableConfig(table).foreignKeys.find(
				(f) => getTableConfig(f.reference().foreignTable).name === target
			);
			expect(fk?.onDelete).toBe('cascade');
		}
	);

	it('tasting_participant → user restricts deletes (participants are deactivated instead)', () => {
		const fk = getTableConfig(schema.tastingParticipant).foreignKeys.find(
			(f) => getTableConfig(f.reference().foreignTable).name === 'user'
		);
		expect(fk?.onDelete).toBe('restrict');
	});
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
			tasting_bottle_bottling_length: `length("tasting_bottle"."bottling") BETWEEN 1 AND ${TASTING_BOTTLING_LENGTH.max}`,
			tasting_bottle_age_range: `"tasting_bottle"."age" BETWEEN ${TASTING_AGE.min} AND ${TASTING_AGE.max}`,
			tasting_bottle_abv_range: `"tasting_bottle"."abv" BETWEEN ${TASTING_ABV.min} AND ${TASTING_ABV.max}`,
			tasting_bottle_smoke_range: `"tasting_bottle"."smoke" BETWEEN ${TASTING_SCALE.min} AND ${TASTING_SCALE.max}`,
			tasting_bottle_slot_range: `"tasting_bottle"."slot" BETWEEN 1 AND ${TASTING_BOTTLE_SLOTS.max}`
		});
	});

	it('tie the factors to the archive flag: none for archived bottles, all three otherwise', () => {
		const archivedFactors = checksOf(schema.tastingBottle).find(
			(c) => c.name === 'tasting_bottle_archived_factors'
		);
		expect(archivedFactors?.sql).toBe(
			'("tasting_bottle"."archived" = 0 AND "tasting_bottle"."smoke" IS NOT NULL AND "tasting_bottle"."cask" IS NOT NULL AND "tasting_bottle"."value" IS NOT NULL) OR ("tasting_bottle"."archived" = 1 AND "tasting_bottle"."smoke" IS NULL AND "tasting_bottle"."cask" IS NULL AND "tasting_bottle"."value" IS NULL)'
		);
	});

	it('leave the number of bottles to the participants', () => {
		expect(checksOf(schema.tasting).map((c) => c.name)).toEqual(['tasting_name_length']);
	});

	it('declare the (participant, slot) pair unique', () => {
		const [index] = getTableConfig(schema.tastingBottle).indexes;
		expect(index.config).toMatchObject({
			name: 'tasting_bottle_participant_slot_unique',
			unique: true
		});
	});

	it('declare the (tasting, user) pair unique', () => {
		const [index] = getTableConfig(schema.tastingParticipant).indexes;
		expect(index.config).toMatchObject({
			name: 'tasting_participant_tasting_user_unique',
			unique: true
		});
	});
});

describe('migrated tasting tables', () => {
	let db: BetterSQLite3Database<typeof schema>;

	beforeEach(() => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, './drizzle');
		db = drizzle(sqlite, { schema });
		db.insert(schema.user)
			.values({
				id: 'u1',
				name: 'anna',
				email: 'anna@example.com',
				username: 'anna',
				createdAt: new Date(),
				updatedAt: new Date()
			})
			.run();
		db.insert(schema.tasting)
			.values({
				id: 't1',
				slug: 'fluffy-otter',
				name: 'Herbst',
				tastingDate: '2026-10-24',
				createdAt: new Date()
			})
			.run();
		db.insert(schema.tastingParticipant)
			.values({ id: 'p1', tastingId: 't1', userId: 'u1', createdAt: new Date() })
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
		{ field: 'slot', value: 0 },
		{ field: 'slot', value: TASTING_BOTTLE_SLOTS.max + 1 }
	])('rejects $field = $value', ({ field, value }) => {
		expect(() => insertBottle({ [field]: value })).toThrow(/CHECK constraint failed/);
	});

	// Literally 120, not the constant: catches a migration lagging behind validation.ts.
	it('accepts a bottling of 120 characters, but not 121', () => {
		insertBottle({ bottling: 'x'.repeat(120) });
		expect(() => insertBottle({ id: 'b2', slot: 2, bottling: 'x'.repeat(121) })).toThrow(
			/CHECK constraint failed: tasting_bottle_bottling_length/
		);
	});

	it('accepts an archived bottle without smoke, cask and value', () => {
		insertBottle({ archived: true, smoke: null, cask: null, value: null });
		expect(db.select().from(schema.tastingBottle).get()).toMatchObject({
			archived: true,
			smoke: null,
			cask: null,
			value: null,
			abv: 46.3
		});
	});

	it.each([
		{ label: 'an archived bottle with its factors', overrides: { archived: true } },
		{
			label: 'an archived bottle with one factor left',
			overrides: { archived: true, smoke: null, cask: null }
		},
		{
			label: 'a bottle without factors that isn’t archived',
			overrides: { smoke: null, cask: null, value: null }
		},
		{ label: 'a bottle missing one factor', overrides: { cask: null } }
	])('rejects $label', ({ overrides }) => {
		expect(() => insertBottle(overrides)).toThrow(
			/CHECK constraint failed: tasting_bottle_archived_factors/
		);
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

	it('refuses to delete a user who took part in a tasting', () => {
		expect(() => db.delete(schema.user).run()).toThrow(/FOREIGN KEY constraint failed/);
	});

	it('rejects the same user twice in one tasting', () => {
		expect(() =>
			db
				.insert(schema.tastingParticipant)
				.values({ id: 'p2', tastingId: 't1', userId: 'u1', createdAt: new Date() })
				.run()
		).toThrow(/UNIQUE constraint failed/);
	});

	it('rejects a second tasting with the same slug', () => {
		expect(() =>
			db
				.insert(schema.tasting)
				.values({
					id: 't2',
					slug: 'fluffy-otter',
					name: 'Winter',
					tastingDate: '2026-12-12',
					createdAt: new Date()
				})
				.run()
		).toThrow(/UNIQUE constraint failed/);
	});
});

describe('distillery tables', () => {
	let db: BetterSQLite3Database<typeof schema>;

	beforeEach(() => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, './drizzle');
		db = drizzle(sqlite, { schema });
	});

	function insert(values: Partial<typeof schema.distillery.$inferInsert> = {}) {
		db.insert(schema.distillery)
			.values({ nameKey: 'ardbeg', updatedAt: new Date(), ...values })
			.run();
	}

	it('inline the bounds of their CHECKs', () => {
		const checks = [schema.distillery, schema.distilleryResearchCall].flatMap(checksOf);
		expect(checks.length).toBeGreaterThan(0);
		for (const c of checks) {
			expect(c.params, c.name).toEqual([]);
			expect(c.sql, c.name).not.toContain('?');
		}
		const sqlByName = Object.fromEntries(checksOf(schema.distillery).map((c) => [c.name, c.sql]));
		expect(sqlByName).toMatchObject({
			distillery_country_length: `length("distillery"."country") BETWEEN 1 AND ${DISTILLERY_COUNTRY_LENGTH.max}`,
			distillery_capacity_range: `"distillery"."capacity" BETWEEN ${DISTILLERY_CAPACITY.min} AND ${DISTILLERY_CAPACITY.max}`,
			distillery_country_source_length: `length("distillery"."country_source") BETWEEN 1 AND ${DISTILLERY_SOURCE_LENGTH.max}`,
			distillery_region_list: `"distillery"."region" IN ('Islay', 'Campbeltown', 'Inseln', 'Speyside', 'Highlands', 'Lowlands')`,
			distillery_region_country: `"distillery"."region" IS NULL OR "distillery"."country" = 'Schottland'`
		});
	});

	it('start every value as never researched', () => {
		insert();
		expect(db.select().from(schema.distillery).get()).toMatchObject({
			countryState: 'pending',
			regionState: 'pending',
			capacityState: 'pending'
		});
	});

	it('accept a researched Scottish distillery', () => {
		insert({
			country: 'Schottland',
			countryState: 'found',
			countrySource: 'https://en.wikipedia.org/wiki/Ardbeg',
			countryRules: 'abc',
			region: 'Islay',
			regionState: 'admin',
			capacity: DISTILLERY_CAPACITY.max,
			capacityState: 'found'
		});
		expect(db.select().from(schema.distillery).all()).toHaveLength(1);
	});

	it.each([
		['an unknown state', { countryState: 'guessed' as 'found' }],
		['a value without found or admin state', { country: 'Schottland' }],
		['a found state without value', { countryState: 'found' as const }],
		[
			'a source on an admin value',
			{ country: 'Japan', countryState: 'admin' as const, countrySource: 'https://x.y' }
		],
		['a rules hash on a pending value', { capacityRules: 'abc' }],
		[
			'a country that is too long',
			{ country: 'x'.repeat(DISTILLERY_COUNTRY_LENGTH.max + 1), countryState: 'admin' as const }
		],
		['a capacity of 0', { capacity: 0, capacityState: 'admin' as const }],
		[
			'a region outside the list',
			{
				country: 'Schottland',
				countryState: 'admin' as const,
				region: 'Skye' as 'Islay',
				regionState: 'admin' as const
			}
		],
		[
			'a region outside Scotland',
			{
				country: 'Irland',
				countryState: 'admin' as const,
				region: 'Islay' as const,
				regionState: 'admin' as const
			}
		]
	])('reject %s', (_, values) => {
		expect(() => insert(values)).toThrow(/CHECK constraint failed/);
	});

	it('accept only stage 1 or 2 for a research call', () => {
		const call = (stage: number) =>
			db
				.insert(schema.distilleryResearchCall)
				.values({
					createdAt: new Date(),
					nameKey: 'ardbeg',
					stage,
					model: 'claude-opus-5-5',
					inputTokens: 1,
					outputTokens: 1,
					cacheCreationInputTokens: 0,
					cacheReadInputTokens: 0,
					webSearchRequests: 0,
					webFetchRequests: 0,
					costMicroUsd: 24
				})
				.run();
		call(1);
		call(2);
		expect(() => call(3)).toThrow(/CHECK constraint failed/);
	});
});

describe('distillery variant tables', () => {
	let db: BetterSQLite3Database<typeof schema>;

	beforeEach(() => {
		const sqlite = new Database(':memory:');
		runMigrations(sqlite, './drizzle');
		db = drizzle(sqlite, { schema });
	});

	function suggest(values: Partial<typeof schema.distilleryVariantSuggestion.$inferInsert> = {}) {
		db.insert(schema.distilleryVariantSuggestion)
			.values({
				variantKey: 'stoisha',
				targetKey: 'bunnahabhain',
				targetName: 'Bunnahabhain',
				kind: 'brand',
				prefix: 'Stoisha',
				createdAt: new Date(),
				...values
			})
			.run();
	}

	it('inline the bounds of their CHECKs', () => {
		const checks = checksOf(schema.distilleryVariantSuggestion);
		for (const c of checks) {
			expect(c.params, c.name).toEqual([]);
			expect(c.sql, c.name).not.toContain('?');
		}
		expect(Object.fromEntries(checks.map((c) => [c.name, c.sql]))).toMatchObject({
			distillery_variant_suggestion_target_length: `length("distillery_variant_suggestion"."target_name") BETWEEN 1 AND ${TASTING_DISTILLERY_LENGTH.max}`,
			distillery_variant_suggestion_prefix_length: `length("distillery_variant_suggestion"."prefix") BETWEEN 1 AND ${TASTING_BOTTLING_LENGTH.max}`,
			distillery_variant_suggestion_kind: `"distillery_variant_suggestion"."kind" IN ('spelling', 'brand')`
		});
	});

	it('start a suggestion as open and accept a spelling variant without prefix', () => {
		suggest();
		suggest({
			variantKey: 'laphroaig distillery',
			targetKey: 'laphroaig',
			targetName: 'Laphroaig',
			kind: 'spelling',
			prefix: null
		});
		expect(
			db
				.select()
				.from(schema.distilleryVariantSuggestion)
				.all()
				.map((s) => s.status)
		).toEqual(['open', 'open']);
	});

	it.each([
		['a brand without prefix', { prefix: null }],
		['a spelling variant with prefix', { kind: 'spelling' as const }],
		['an unknown kind', { kind: 'typo' as 'brand' }],
		['an unknown status', { status: 'accepted' as 'open' }],
		['the same key on both sides', { targetKey: 'stoisha' }],
		['a target that is too long', { targetName: 'x'.repeat(TASTING_DISTILLERY_LENGTH.max + 1) }],
		['a prefix that is too long', { prefix: 'x'.repeat(TASTING_BOTTLING_LENGTH.max + 1) }]
	])('reject %s', (_, values) => {
		expect(() => suggest(values)).toThrow(/CHECK constraint failed/);
	});

	it('keep a pair once', () => {
		suggest();
		expect(() => suggest({ status: 'rejected' })).toThrow(/UNIQUE constraint failed/);
	});

	it('store the costs of a variant search call', () => {
		db.insert(schema.distilleryVariantCall)
			.values({
				createdAt: new Date(),
				model: 'claude-opus-5-5',
				inputTokens: 10,
				outputTokens: 5,
				cacheCreationInputTokens: 0,
				cacheReadInputTokens: 0,
				costMicroUsd: 140
			})
			.run();
		expect(db.select().from(schema.distilleryVariantCall).get()?.costMicroUsd).toBe(140);
	});
});
