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
	refreshTarget,
	resetResearchRules,
	researchTargets,
	saveResearchRules,
	updateDistilleryFacts
} from './distilleries';
import { DEFAULT_RESEARCH_RULES, rulesHash, type ResearchCall } from './distilleryResearch';
import { listReleasedDistilleryNames, listRevealedDistilleryNames } from './tastings';

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

/** A tasting with bottles `[user, slot, distillery]`, inserted directly. */
function tasting(
	id: string,
	date: string,
	bottles: Array<[string, number, string]>,
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
	for (const [userId, slot, distillery] of bottles) {
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
				updatedAt: EARLIER
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

	it('puts the values never researched first, then the ones touched longest ago', () => {
		tasting('more', '2026-10-02', [
			['u-anna', 1, 'Lagavulin'],
			['u-anna', 2, 'Glenfarclas']
		]);
		// Nothing found: the region of an unknown country was never looked for either.
		const notFound = { countryState: 'empty', capacityState: 'empty' } as const;
		seedRow('ardbeg', { ...notFound, updatedAt: new Date('2026-10-10T10:00:00Z') });
		seedRow('bushmills', { ...notFound, updatedAt: new Date('2026-10-05T10:00:00Z') });
		// The region is still never researched, despite the recent row.
		seedRow('lagavulin', {
			country: 'Schottland',
			countryState: 'found',
			capacity: 1_000,
			capacityState: 'admin',
			updatedAt: new Date('2026-10-12T10:00:00Z')
		});

		expect(researchTargets(db, 'manual', NOW).map((t) => t.key)).toEqual([
			'lagavulin',
			'glenfarclas',
			'bushmills',
			'ardbeg'
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
				costMicroUsd: 500_000
			},
			{
				key: 'bushmills',
				name: 'Bushmills',
				country: { value: 'Nordirland', state: 'admin', source: null },
				// Another country: no region, not even a state.
				region: null,
				capacity: { value: null, state: 'pending', source: null },
				costMicroUsd: 0
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
