import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { runMigrations } from './db/migrate';
import {
	applyResearchResult,
	getAdminDistilleries,
	getResearchRules,
	getTotalResearchCost,
	recordResearchCall,
	recordVariantCall,
	refreshTarget,
	renameDistillery,
	resetResearchRules,
	researchTargets,
	saveResearchRules,
	updateDistilleryFacts
} from './distilleries';
import { DEFAULT_RESEARCH_RULES, rulesHash, type ResearchCall } from './distilleryResearch';
import {
	getStatistics,
	listReleasedDistilleryNames,
	listRevealedDistilleryNames
} from './tastings';
import { TASTING_BOTTLING_LENGTH } from '$lib/validation';

// 21:30 Berlin (CEST) on 16.10.2026.
const NOW = new Date('2026-10-16T19:30:00Z');
const EARLIER = new Date('2026-09-01T10:00:00Z');

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	for (const [id, username] of [
		['u-anna', 'Anna'],
		['u-ben', 'Ben']
	]) {
		db.insert(schema.user)
			.values({
				id,
				name: username,
				email: `${username.toLowerCase()}@example.com`,
				username,
				createdAt: EARLIER,
				updatedAt: EARLIER
			})
			.run();
	}
});

type BottleValues = Partial<typeof schema.tastingBottle.$inferInsert>;

/** A tasting with bottles `[user, slot, distillery, values?]`, inserted directly. */
function tasting(
	id: string,
	date: string,
	bottles: Array<[string, number, string, BottleValues?]>,
	manual: { revealedAt?: Date; orderOpenedAt?: Date } = {}
) {
	db.insert(schema.tasting)
		.values({ id, slug: `slug-${id}`, name: id, tastingDate: date, createdAt: EARLIER, ...manual })
		.run();
	for (const userId of new Set(bottles.map(([user]) => user))) {
		db.insert(schema.tastingParticipant)
			.values({ id: `${id}-${userId}`, tastingId: id, userId, createdAt: EARLIER })
			.run();
	}
	for (const [userId, slot, distillery, values] of bottles) {
		db.insert(schema.tastingBottle)
			.values({
				id: `${id}-${userId}-${slot}`,
				participantId: `${id}-${userId}`,
				slot,
				alias: `${id}${userId}${slot}`,
				distillery,
				abv: 46,
				smoke: 1,
				cask: 1,
				value: 1,
				updatedAt: EARLIER,
				...values
			})
			.run();
	}
}

function row(key: string) {
	return db.select().from(schema.distillery).where(eq(schema.distillery.nameKey, key)).get();
}

function seedRow(key: string, values: Partial<typeof schema.distillery.$inferInsert>) {
	db.insert(schema.distillery)
		.values({ nameKey: key, updatedAt: EARLIER, ...values })
		.run();
}

const call = (costMicroUsd: number): ResearchCall => ({
	stage: 1,
	model: 'claude-opus-5-5',
	inputTokens: 1,
	outputTokens: 1,
	cacheCreationInputTokens: 0,
	cacheReadInputTokens: 0,
	webSearchRequests: 0,
	webFetchRequests: 0,
	costMicroUsd
});

describe('distillery names of released and revealed tastings', () => {
	beforeEach(() => {
		tasting('revealed', '2026-10-01', [
			['u-ben', 1, 'ardbeg'],
			['u-anna', 2, 'Lagavulin'],
			['u-anna', 1, 'Ardbeg']
		]);
		// Released at 21:00, but revealed only tomorrow at 9:00.
		tasting('tonight', '2026-10-16', [['u-anna', 1, 'Bushmills']]);
		tasting('upcoming', '2026-10-20', [['u-anna', 1, 'Springbank']]);
	});

	it('lists the released ones in standard order (date, username, slot)', () => {
		expect(listReleasedDistilleryNames(db, NOW)).toEqual([
			'Ardbeg',
			'Lagavulin',
			'ardbeg',
			'Bushmills'
		]);
	});

	it('releases a tasting at 21:00, not before', () => {
		expect(listReleasedDistilleryNames(db, new Date('2026-10-16T18:59:59Z'))).not.toContain(
			'Bushmills'
		);
		expect(listReleasedDistilleryNames(db, new Date('2026-10-16T19:00:00Z'))).toContain(
			'Bushmills'
		);
	});

	it('releases a tasting revealed early before 21:00', () => {
		tasting('early', '2026-10-17', [['u-ben', 1, 'Talisker']], {
			orderOpenedAt: NOW,
			revealedAt: NOW
		});
		expect(listReleasedDistilleryNames(db, NOW)).toContain('Talisker');
		expect(listRevealedDistilleryNames(db, NOW)).toContain('Talisker');
	});

	it('lists only the revealed ones for the admin table', () => {
		expect(listRevealedDistilleryNames(db, NOW)).toEqual(['Ardbeg', 'Lagavulin', 'ardbeg']);
		expect(listRevealedDistilleryNames(db, new Date('2026-10-17T07:00:00Z'))).toContain(
			'Bushmills'
		);
	});

	it('is empty without tastings', () => {
		db.delete(schema.tasting).run();
		expect(listReleasedDistilleryNames(db, NOW)).toEqual([]);
	});
});

describe('researchTargets', () => {
	beforeEach(() => {
		tasting('revealed', '2026-10-01', [
			['u-anna', 1, 'Ardbeg'],
			['u-anna', 2, 'Blend'],
			['u-ben', 1, 'ARDBEG'],
			['u-ben', 2, 'Unbekannt'],
			['u-ben', 3, 'Bushmills']
		]);
		tasting('upcoming', '2026-10-20', [['u-anna', 1, 'Springbank']]);
	});

	it('takes every value of a distillery never researched, without placeholders', () => {
		expect(researchTargets(db, 'pending', NOW)).toEqual([
			{
				key: 'ardbeg',
				name: 'Ardbeg',
				fields: ['country', 'region', 'capacity'],
				knownCountry: null
			},
			{
				key: 'bushmills',
				name: 'Bushmills',
				fields: ['country', 'region', 'capacity'],
				knownCountry: null
			}
		]);
	});

	it('looks only for what is still open, the region only with Scotland', () => {
		seedRow('ardbeg', {
			country: 'Schottland',
			countryState: 'found',
			capacity: 1_400_000,
			capacityState: 'admin'
		});
		seedRow('bushmills', { country: 'Nordirland', countryState: 'admin' });

		expect(researchTargets(db, 'pending', NOW)).toEqual([
			{ key: 'ardbeg', name: 'Ardbeg', fields: ['region'], knownCountry: 'Schottland' },
			{ key: 'bushmills', name: 'Bushmills', fields: ['capacity'], knownCountry: 'Nordirland' }
		]);
	});

	it('retries the values not found only by hand', () => {
		seedRow('ardbeg', {
			country: 'Schottland',
			countryState: 'found',
			regionState: 'empty',
			capacityState: 'empty'
		});
		// Country not found: the region stays unsearched until the country is known.
		seedRow('bushmills', { countryState: 'empty', capacityState: 'empty' });

		expect(researchTargets(db, 'pending', NOW)).toEqual([]);
		expect(researchTargets(db, 'manual', NOW)).toEqual([
			{
				key: 'ardbeg',
				name: 'Ardbeg',
				fields: ['region', 'capacity'],
				knownCountry: 'Schottland'
			},
			{
				key: 'bushmills',
				name: 'Bushmills',
				fields: ['country', 'region', 'capacity'],
				knownCountry: null
			}
		]);
	});

	it('puts the values never researched first, then the rest, each by the last research', () => {
		tasting('more', '2026-10-02', [
			['u-anna', 1, 'Lagavulin'],
			['u-anna', 2, 'Glenfarclas']
		]);
		// Nothing found: the region of an unknown country was never looked for either.
		const notFound = { countryState: 'empty', capacityState: 'empty' } as const;
		// Cleared by the admin just now, but researched longest ago: the edit doesn't count.
		seedRow('ardbeg', { ...notFound, updatedAt: new Date('2026-10-15T10:00:00Z') });
		recordResearchCall(db, 'ardbeg', call(1), new Date('2026-10-05T10:00:00Z'));
		seedRow('bushmills', notFound);
		recordResearchCall(db, 'bushmills', call(1), new Date('2026-10-10T10:00:00Z'));
		// The region is still never researched, after an earlier research.
		seedRow('lagavulin', {
			country: 'Schottland',
			countryState: 'found',
			capacity: 1_000,
			capacityState: 'admin'
		});
		recordResearchCall(db, 'lagavulin', call(1), new Date('2026-10-12T10:00:00Z'));

		expect(researchTargets(db, 'manual', NOW).map((t) => t.key)).toEqual([
			'glenfarclas',
			'lagavulin',
			'ardbeg',
			'bushmills'
		]);
	});

	it('is empty when nothing is released', () => {
		expect(researchTargets(db, 'pending', new Date('2026-09-30T10:00:00Z'))).toEqual([]);
	});
});

describe('refreshTarget', () => {
	it('drops what was decided since the run listed its targets', () => {
		tasting('revealed', '2026-10-01', [['u-anna', 1, 'Ardbeg']]);
		const [target] = researchTargets(db, 'pending', NOW);

		seedRow('ardbeg', { country: 'Irland', countryState: 'admin' });
		expect(refreshTarget(db, target, 'pending')).toEqual({
			...target,
			fields: ['capacity'],
			knownCountry: 'Irland'
		});

		db.update(schema.distillery).set({ capacity: 5, capacityState: 'admin' }).run();
		expect(refreshTarget(db, target, 'pending')).toBeNull();
	});
});

describe('applyResearchResult', () => {
	const source = 'https://en.wikipedia.org/wiki/Ardbeg';
	const fact = <T>(value: T) => ({ value, source, quote: 'q' });

	it('stores found values with source and rules hash, not found ones as empty', () => {
		applyResearchResult(
			db,
			'ardbeg',
			{ country: fact('Schottland'), region: fact('Islay'), capacity: null },
			DEFAULT_RESEARCH_RULES,
			'pending',
			NOW
		);

		expect(row('ardbeg')).toEqual({
			nameKey: 'ardbeg',
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			countryRules: rulesHash(DEFAULT_RESEARCH_RULES),
			region: 'Islay',
			regionState: 'found',
			regionSource: source,
			regionRules: rulesHash(DEFAULT_RESEARCH_RULES),
			capacity: null,
			capacityState: 'empty',
			capacitySource: null,
			capacityRules: null,
			updatedAt: NOW
		});
	});

	it('never overwrites a found or admin value, also not a cleared one without "manual"', () => {
		seedRow('ardbeg', {
			country: 'Schottland',
			countryState: 'admin',
			capacity: 1_000,
			capacityState: 'found',
			capacitySource: source,
			regionState: 'empty'
		});

		applyResearchResult(
			db,
			'ardbeg',
			{ country: fact('England'), region: fact('Islay'), capacity: fact(2_000) },
			DEFAULT_RESEARCH_RULES,
			'pending',
			NOW
		);

		expect(row('ardbeg')).toMatchObject({
			country: 'Schottland',
			countryState: 'admin',
			capacity: 1_000,
			regionState: 'empty',
			updatedAt: EARLIER
		});

		applyResearchResult(db, 'ardbeg', { region: fact('Islay') }, 'rules', 'manual', NOW);
		expect(row('ardbeg')).toMatchObject({ region: 'Islay', regionState: 'found' });
	});

	it('takes a region only with Scotland as the country', () => {
		seedRow('bushmills', { country: 'Nordirland', countryState: 'admin' });

		applyResearchResult(db, 'bushmills', { region: fact('Islay') }, 'rules', 'pending', NOW);
		applyResearchResult(
			db,
			'teeling',
			{ country: fact('Irland'), region: fact('Islay') },
			'rules',
			'pending',
			NOW
		);

		expect(row('bushmills')).toMatchObject({ region: null, regionState: 'pending' });
		expect(row('teeling')).toMatchObject({
			country: 'Irland',
			region: null,
			regionState: 'pending'
		});
	});

	it('creates no row without decided values', () => {
		applyResearchResult(db, 'ardbeg', {}, 'rules', 'pending', NOW);
		expect(row('ardbeg')).toBeUndefined();
	});
});

describe('research costs', () => {
	it('sums all calls, also of distilleries not shown', () => {
		expect(getTotalResearchCost(db)).toBe(0);
		recordResearchCall(db, 'ardbeg', call(400_000), NOW);
		recordResearchCall(db, 'ardbeg', call(100_000), NOW);
		recordResearchCall(db, 'secret', call(50_000), NOW);

		expect(getTotalResearchCost(db)).toBe(550_000);

		// The variant search counts as well.
		recordVariantCall(
			db,
			{
				model: 'claude-opus-5-5',
				inputTokens: 10,
				outputTokens: 5,
				cacheCreationInputTokens: 0,
				cacheReadInputTokens: 0,
				costMicroUsd: 7_000
			},
			NOW
		);
		expect(getTotalResearchCost(db)).toBe(557_000);
		expect(
			db
				.select()
				.from(schema.distilleryResearchCall)
				.where(eq(schema.distilleryResearchCall.nameKey, 'secret'))
				.get()
		).toMatchObject({ stage: 1, model: 'claude-opus-5-5', costMicroUsd: 50_000, createdAt: NOW });
	});
});

describe('getAdminDistilleries', () => {
	const source = 'https://scotchwhisky.com/whiskypedia/1/ardbeg/';

	beforeEach(() => {
		tasting('revealed', '2026-10-01', [
			['u-ben', 1, 'ardbeg'],
			['u-anna', 1, 'Ardbeg'],
			['u-anna', 2, 'Blend'],
			['u-ben', 2, 'Bushmills']
		]);
		tasting('tonight', '2026-10-16', [['u-anna', 1, 'Secret Still']]);
	});

	it('shows only distilleries of revealed tastings, with first spelling, values and costs', () => {
		seedRow('ardbeg', {
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			countryRules: 'abc',
			region: 'Islay',
			regionState: 'admin',
			capacityState: 'empty'
		});
		seedRow('bushmills', { country: 'Nordirland', countryState: 'admin', regionState: 'empty' });
		recordResearchCall(db, 'ardbeg', call(300_000), NOW);
		recordResearchCall(db, 'ardbeg', call(200_000), NOW);
		// Researched after 21:00, but not revealed yet: neither name nor costs show.
		recordResearchCall(db, 'secret still', call(90_000), NOW);

		expect(getAdminDistilleries(db, NOW)).toEqual([
			{
				key: 'ardbeg',
				name: 'Ardbeg',
				country: { value: 'Schottland', state: 'found', source },
				region: { value: 'Islay', state: 'admin', source: null },
				capacity: { value: null, state: 'empty', source: null },
				costMicroUsd: 500_000,
				bottles: [
					{ age: null, bottling: null, bottler: null },
					{ age: null, bottling: null, bottler: null }
				]
			},
			{
				key: 'bushmills',
				name: 'Bushmills',
				country: { value: 'Nordirland', state: 'admin', source: null },
				// Another country: no region, not even a state.
				region: null,
				capacity: { value: null, state: 'pending', source: null },
				costMicroUsd: 0,
				bottles: [{ age: null, bottling: null, bottler: null }]
			}
		]);
	});

	it('shows no region while the country is unknown', () => {
		expect(getAdminDistilleries(db, NOW)[0]).toMatchObject({
			country: { value: null, state: 'pending', source: null },
			region: null
		});
	});

	it('is empty before anything is revealed', () => {
		expect(getAdminDistilleries(db, new Date('2026-09-01T10:00:00Z'))).toEqual([]);
	});
});

describe('updateDistilleryFacts', () => {
	const source = 'https://en.wikipedia.org/wiki/Ardbeg';

	beforeEach(() => {
		tasting('revealed', '2026-10-01', [['u-anna', 1, 'Ardbeg']]);
		tasting('tonight', '2026-10-16', [['u-anna', 1, 'Secret Still']]);
		seedRow('ardbeg', {
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			countryRules: 'abc',
			region: 'Islay',
			regionState: 'found',
			regionSource: source,
			capacity: 1_000,
			capacityState: 'found',
			capacitySource: source
		});
	});

	it('only changes the values the admin changed', () => {
		expect(
			updateDistilleryFacts(
				db,
				'ardbeg',
				{ country: 'Schottland', region: 'Islay', capacity: 1_400_000 },
				NOW
			)
		).toBe(true);

		expect(row('ardbeg')).toMatchObject({
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			regionState: 'found',
			capacity: 1_400_000,
			capacityState: 'admin',
			capacitySource: null,
			capacityRules: null,
			updatedAt: NOW
		});
	});

	it('makes a cleared value "not found"', () => {
		updateDistilleryFacts(
			db,
			'ardbeg',
			{ country: 'Schottland', region: null, capacity: null },
			NOW
		);

		expect(row('ardbeg')).toMatchObject({
			region: null,
			regionState: 'empty',
			regionSource: null,
			capacity: null,
			capacityState: 'empty'
		});
	});

	it('makes the region "never researched" again when the country leaves Scotland', () => {
		updateDistilleryFacts(db, 'ardbeg', { country: 'Irland', region: null, capacity: 1_000 }, NOW);

		expect(row('ardbeg')).toMatchObject({
			country: 'Irland',
			countryState: 'admin',
			countrySource: null,
			region: null,
			regionState: 'pending',
			regionSource: null,
			capacityState: 'found'
		});
	});

	it('creates the row for a distillery never researched', () => {
		tasting('older', '2026-09-20', [['u-ben', 1, 'Lagavulin']]);
		updateDistilleryFacts(
			db,
			'lagavulin',
			{ country: 'Schottland', region: 'Islay', capacity: null },
			NOW
		);

		expect(row('lagavulin')).toMatchObject({
			countryState: 'admin',
			region: 'Islay',
			regionState: 'admin',
			capacityState: 'pending'
		});
	});

	it('refuses a distillery that is not in the admin table', () => {
		const none = { country: 'Japan', region: null, capacity: null };
		expect(updateDistilleryFacts(db, 'secret still', none, NOW)).toBe(false);
		expect(updateDistilleryFacts(db, 'nowhere', none, NOW)).toBe(false);
		expect(row('secret still')).toBeUndefined();
	});
});

describe('renameDistillery', () => {
	const source = 'https://scotchwhisky.com/whiskypedia/2/bunnahabhain/';
	// The values as the edit form sends them unchanged.
	const unchanged = { country: null, region: null, capacity: null };

	function bottles() {
		return db
			.select({
				id: schema.tastingBottle.id,
				distillery: schema.tastingBottle.distillery,
				bottling: schema.tastingBottle.bottling
			})
			.from(schema.tastingBottle)
			.orderBy(schema.tastingBottle.id)
			.all();
	}

	function calls() {
		return db
			.select({ key: schema.distilleryResearchCall.nameKey })
			.from(schema.distilleryResearchCall)
			.all()
			.map((c) => c.key);
	}

	function suggest(variantKey: string, targetKey: string, status: 'open' | 'rejected' = 'open') {
		db.insert(schema.distilleryVariantSuggestion)
			.values({
				variantKey,
				targetKey,
				targetName: targetKey,
				kind: 'spelling',
				status,
				createdAt: EARLIER
			})
			.run();
	}

	beforeEach(() => {
		tasting('revealed', '2026-10-01', [
			['u-anna', 1, 'Stoisha', { bottling: '12 Jahre Edition' }],
			['u-ben', 1, 'stoisha'],
			['u-ben', 2, 'Bunnahabhain'],
			['u-anna', 2, 'unknown']
		]);
		tasting('archive', '2025-03-01', [
			[
				'u-anna',
				1,
				'Stoisha',
				{ archived: true, smoke: null, cask: null, value: null, bottling: 'Stoisha Fois' }
			]
		]);
		// Released, but not revealed: stays as it is.
		tasting('tonight', '2026-10-16', [['u-anna', 1, 'Stoisha']]);
	});

	it('renames: every revealed bottle, archived ones too, and the row with all its values', () => {
		seedRow('stoisha', {
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			countryRules: 'abc',
			regionState: 'empty',
			capacityState: 'empty'
		});
		recordResearchCall(db, 'stoisha', call(300_000), NOW);

		expect(
			renameDistillery(
				db,
				'stoisha',
				{
					name: 'Stoisha Distillery',
					prefix: null,
					facts: { country: 'Schottland', region: null, capacity: null }
				},
				NOW
			)
		).toEqual({ status: 'renamed', bottles: 3 });

		expect(bottles()).toEqual([
			{ id: 'archive-u-anna-1', distillery: 'Stoisha Distillery', bottling: 'Stoisha Fois' },
			{ id: 'revealed-u-anna-1', distillery: 'Stoisha Distillery', bottling: '12 Jahre Edition' },
			{ id: 'revealed-u-anna-2', distillery: 'unknown', bottling: null },
			{ id: 'revealed-u-ben-1', distillery: 'Stoisha Distillery', bottling: null },
			{ id: 'revealed-u-ben-2', distillery: 'Bunnahabhain', bottling: null },
			{ id: 'tonight-u-anna-1', distillery: 'Stoisha', bottling: null }
		]);
		expect(row('stoisha')).toBeUndefined();
		expect(row('stoisha distillery')).toMatchObject({
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			countryRules: 'abc',
			regionState: 'empty',
			capacityState: 'empty',
			updatedAt: NOW
		});
		expect(calls()).toEqual(['stoisha distillery']);
		expect(getTotalResearchCost(db)).toBe(300_000);
	});

	it('puts the brand in front of the bottling, makes it the bottling or leaves a bottling that starts with it', () => {
		expect(
			renameDistillery(
				db,
				'stoisha',
				{ name: 'Bunnahabhain', prefix: 'Stoisha', facts: unchanged },
				NOW
			)
		).toEqual({ status: 'merged', bottles: 3 });

		expect(bottles().filter((b) => b.distillery === 'Bunnahabhain')).toEqual([
			{ id: 'archive-u-anna-1', distillery: 'Bunnahabhain', bottling: 'Stoisha Fois' },
			{ id: 'revealed-u-anna-1', distillery: 'Bunnahabhain', bottling: 'Stoisha 12 Jahre Edition' },
			{ id: 'revealed-u-ben-1', distillery: 'Bunnahabhain', bottling: 'Stoisha' },
			{ id: 'revealed-u-ben-2', distillery: 'Bunnahabhain', bottling: null }
		]);
	});

	it('writes nothing when a bottling would get too long', () => {
		seedRow('stoisha', { country: 'Schottland', countryState: 'admin' });
		const before = bottles();
		const prefix = 'x'.repeat(TASTING_BOTTLING_LENGTH.max - 'Edition'.length);

		expect(
			renameDistillery(
				db,
				'stoisha',
				{ name: 'Bunnahabhain', prefix, facts: { country: 'Japan', region: null, capacity: null } },
				NOW
			)
		).toEqual({ status: 'bottling-too-long' });
		expect(bottles()).toEqual(before);
		expect(row('stoisha')).toMatchObject({ country: 'Schottland', countryState: 'admin' });
	});

	it('merges: the target keeps its known values and takes only known ones of the variant', () => {
		seedRow('bunnahabhain', {
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			countryRules: 'abc',
			regionState: 'empty',
			capacityState: 'pending'
		});
		seedRow('stoisha', {
			country: 'Irland',
			countryState: 'admin',
			capacity: 2_700_000,
			capacityState: 'found',
			capacitySource: source,
			capacityRules: 'def'
		});
		recordResearchCall(db, 'bunnahabhain', call(100_000), NOW);
		recordResearchCall(db, 'stoisha', call(200_000), NOW);

		expect(
			renameDistillery(
				db,
				'stoisha',
				{
					name: 'Bunnahabhain',
					prefix: null,
					facts: { country: 'Irland', region: null, capacity: 2_700_000 }
				},
				NOW
			)
		).toEqual({ status: 'merged', bottles: 3 });

		expect(row('stoisha')).toBeUndefined();
		expect(row('bunnahabhain')).toMatchObject({
			country: 'Schottland',
			countryState: 'found',
			countrySource: source,
			regionState: 'empty',
			capacity: 2_700_000,
			capacityState: 'found',
			capacitySource: source,
			capacityRules: 'def'
		});
		expect(calls()).toEqual(['bunnahabhain', 'bunnahabhain']);
		expect(getTotalResearchCost(db)).toBe(300_000);
		expect(getAdminDistilleries(db, NOW).find((d) => d.key === 'bunnahabhain')).toMatchObject({
			costMicroUsd: 300_000,
			bottles: [expect.anything(), expect.anything(), expect.anything(), expect.anything()]
		});
	});

	it('takes a region only if the target ends up in Scotland', () => {
		const scottish = {
			country: 'Schottland',
			countryState: 'found' as const,
			region: 'Islay' as const,
			regionState: 'found' as const
		};
		seedRow('stoisha', scottish);
		seedRow('bunnahabhain', { country: 'Irland', countryState: 'admin' });
		renameDistillery(
			db,
			'stoisha',
			{
				name: 'Bunnahabhain',
				prefix: null,
				facts: { country: 'Schottland', region: 'Islay', capacity: null }
			},
			NOW
		);
		expect(row('bunnahabhain')).toMatchObject({
			country: 'Irland',
			region: null,
			regionState: 'pending'
		});

		// Without a country of its own, the target takes country and region.
		tasting('more', '2026-09-01', [
			['u-anna', 1, 'Port Charlotte'],
			['u-ben', 1, 'Bruichladdich']
		]);
		seedRow('port charlotte', scottish);
		renameDistillery(
			db,
			'port charlotte',
			{
				name: 'Bruichladdich',
				prefix: null,
				facts: { country: 'Schottland', region: 'Islay', capacity: null }
			},
			NOW
		);
		expect(row('bruichladdich')).toMatchObject({
			country: 'Schottland',
			region: 'Islay',
			regionState: 'found'
		});
	});

	it('merges into a distillery of the table without row: only the known values, and the edit first', () => {
		seedRow('stoisha', { regionState: 'empty', capacityState: 'empty' });

		renameDistillery(
			db,
			'stoisha',
			{
				name: 'bunnahabhain',
				prefix: null,
				facts: { country: 'Schottland', region: null, capacity: null }
			},
			NOW
		);

		// The edit set the country (admin), an "empty" of the variant isn't taken.
		expect(row('bunnahabhain')).toMatchObject({
			country: 'Schottland',
			countryState: 'admin',
			regionState: 'pending',
			capacityState: 'pending'
		});
	});

	it('merges into a row without revealed bottle instead of taking its key', () => {
		seedRow('talisker', { capacity: 3_300_000, capacityState: 'found', capacitySource: source });
		seedRow('stoisha', { country: 'Schottland', countryState: 'admin' });

		expect(
			renameDistillery(
				db,
				'stoisha',
				{
					name: 'Talisker',
					prefix: null,
					facts: { country: 'Schottland', region: null, capacity: null }
				},
				NOW
			)
		).toEqual({ status: 'merged', bottles: 3 });
		expect(row('talisker')).toMatchObject({
			country: 'Schottland',
			countryState: 'admin',
			capacity: 3_300_000
		});
	});

	it('only rewrites the bottles for another spelling of the same name', () => {
		seedRow('stoisha', { country: 'Schottland', countryState: 'admin' });
		recordResearchCall(db, 'stoisha', call(100_000), NOW);
		suggest('stoisha', 'bunnahabhain');

		expect(
			renameDistillery(
				db,
				'stoisha',
				{
					name: 'STOISHA',
					prefix: null,
					facts: { country: 'Schottland', region: null, capacity: null }
				},
				NOW
			)
		).toEqual({ status: 'respelled', bottles: 3 });

		expect(bottles().filter((b) => b.distillery === 'STOISHA')).toHaveLength(3);
		expect(row('stoisha')).toMatchObject({ country: 'Schottland', updatedAt: EARLIER });
		expect(calls()).toEqual(['stoisha']);
		expect(db.select().from(schema.distilleryVariantSuggestion).all()).toHaveLength(1);
	});

	it('takes a placeholder as target: the variant row goes, no values are taken', () => {
		seedRow('unknown', { country: 'Japan', countryState: 'admin' });
		recordResearchCall(db, 'unknown', call(100_000), NOW);

		expect(
			renameDistillery(
				db,
				'unknown',
				{
					name: 'Unbekannt',
					prefix: null,
					facts: { country: 'Japan', region: null, capacity: null }
				},
				NOW
			)
		).toEqual({ status: 'placeholder', bottles: 1 });

		expect(bottles().find((b) => b.id === 'revealed-u-anna-2')?.distillery).toBe('Unbekannt');
		expect(db.select().from(schema.distillery).all()).toEqual([]);
		expect(getTotalResearchCost(db)).toBe(100_000);
		expect(getAdminDistilleries(db, NOW).map((d) => d.key)).toEqual(['stoisha', 'bunnahabhain']);
	});

	it('drops the open suggestions of the variant, rejected pairs stay', () => {
		suggest('stoisha', 'bunnahabhain');
		suggest('stoisha', 'islay', 'rejected');
		suggest('unknown', 'unbekannt');

		renameDistillery(db, 'stoisha', { name: 'Bunnahabhain', prefix: null, facts: unchanged }, NOW);

		expect(
			db
				.select({
					variant: schema.distilleryVariantSuggestion.variantKey,
					target: schema.distilleryVariantSuggestion.targetKey
				})
				.from(schema.distilleryVariantSuggestion)
				.all()
		).toEqual([
			{ variant: 'stoisha', target: 'islay' },
			{ variant: 'unknown', target: 'unbekannt' }
		]);
	});

	it('refuses a distillery that is not in the admin table', () => {
		tasting('upcoming', '2026-10-20', [['u-anna', 1, 'Secret Still']]);
		const input = { name: 'Ardbeg', prefix: null, facts: unchanged };
		expect(renameDistillery(db, 'secret still', input, NOW)).toEqual({ status: 'not-found' });
		expect(renameDistillery(db, 'nowhere', input, NOW)).toEqual({ status: 'not-found' });
		expect(bottles().find((b) => b.id === 'upcoming-u-anna-1')?.distillery).toBe('Secret Still');
	});

	it('is not reversible and counts a merged distillery once in the statistics', () => {
		const before = getStatistics(db, 'u-anna', NOW)!.overview.distilleries;
		renameDistillery(db, 'stoisha', { name: 'Bunnahabhain', prefix: null, facts: unchanged }, NOW);
		expect(getStatistics(db, 'u-anna', NOW)!.overview.distilleries).toBe(before - 1);

		// Renaming the merged distillery moves all of its bottles together.
		renameDistillery(db, 'bunnahabhain', { name: 'Stoisha', prefix: null, facts: unchanged }, NOW);
		expect(bottles().filter((b) => b.distillery === 'Stoisha')).toHaveLength(5);
	});
});

describe('research rules', () => {
	it('holds only a deviation from the default', () => {
		expect(getResearchRules(db)).toEqual({ text: DEFAULT_RESEARCH_RULES, custom: false });

		saveResearchRules(db, 'Eigene Regeln', NOW);
		expect(getResearchRules(db)).toEqual({ text: 'Eigene Regeln', custom: true });

		saveResearchRules(db, 'Noch andere Regeln', NOW);
		expect(getResearchRules(db)).toEqual({ text: 'Noch andere Regeln', custom: true });

		// The default text itself is no deviation.
		saveResearchRules(db, DEFAULT_RESEARCH_RULES, NOW);
		expect(getResearchRules(db).custom).toBe(false);
		expect(db.select().from(schema.appSetting).all()).toEqual([]);
	});

	it('goes back to the default', () => {
		saveResearchRules(db, 'Eigene Regeln', NOW);
		resetResearchRules(db);
		expect(getResearchRules(db)).toEqual({ text: DEFAULT_RESEARCH_RULES, custom: false });
	});
});
