import { describe, it, expect } from 'vitest';
import { CASK_STRENGTH_ABV } from '$lib/tasting';
import {
	buildStatistics,
	numberBottles,
	type StatisticsBottleInput,
	type StatisticsTastingInput
} from './statistics';

const T1: StatisticsTastingInput = { id: 't1', tastingDate: '2021-05-07' };
const T2: StatisticsTastingInput = { id: 't2', tastingDate: '2022-02-18' };
const T3: StatisticsTastingInput = { id: 't3', tastingDate: '2024-09-27' };

function bottle(overrides: Partial<StatisticsBottleInput> = {}): StatisticsBottleInput {
	return {
		tastingId: 't1',
		slot: 1,
		distillery: 'Ardbeg',
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		whiskybaseUrl: null,
		country: null,
		capacity: null,
		username: 'Anna',
		deactivatedAt: null,
		...overrides
	};
}

/** Bottles of one bringer in one tasting, from slot 1, one per distillery. */
function bottles(
	tastingId: string,
	username: string,
	distilleries: string[],
	overrides: Partial<StatisticsBottleInput> = {}
): StatisticsBottleInput[] {
	return distilleries.map((distillery, i) =>
		bottle({ tastingId, username, slot: i + 1, distillery, ...overrides })
	);
}

/** Like getStatistics: numbered first, then aggregated. */
function build(tastings: StatisticsTastingInput[], inputs: StatisticsBottleInput[]) {
	return buildStatistics(tastings, numberBottles(tastings, inputs));
}

describe('numberBottles', () => {
	const tagged = (tastingId: string, username: string, slot: number, alias: string) => ({
		tastingId,
		username,
		slot,
		alias
	});

	it('numbers the bottles by tasting, bringer (de-DE, not bytes) and slot', () => {
		const result = numberBottles(
			[T1, T2],
			[
				tagged('t2', 'ben', 1, 'P4'),
				tagged('t1', 'Ben', 2, 'P2'),
				tagged('t2', 'Anna', 2, 'P3'),
				tagged('t1', 'Anna', 1, 'P1'),
				tagged('t1', 'Ben', 1, 'P0'),
				// Bytes would put "Ä" after "B".
				tagged('t1', 'Änne', 1, 'P1b')
			]
		);
		expect(result.map((b) => [b.number, b.tastingIndex, b.alias])).toEqual([
			[1, 0, 'P1'],
			[2, 0, 'P1b'],
			[3, 0, 'P0'],
			[4, 0, 'P2'],
			[5, 1, 'P3'],
			[6, 1, 'P4']
		]);
	});

	it('keeps every field of the input and leaves the input alone', () => {
		const input = [tagged('t1', 'Anna', 1, 'P1')];
		expect(numberBottles([T1], input)).toEqual([{ ...input[0], number: 1, tastingIndex: 0 }]);
		expect(input[0]).not.toHaveProperty('number');
	});
});

describe('buildStatistics – bottles', () => {
	it('picks the fields explicitly, in standard order, and labels deactivated bringers', () => {
		const result = build(
			[T1, T2],
			[
				bottle({ tastingId: 't2', username: 'Ben' }),
				bottle({
					username: 'Cem',
					deactivatedAt: new Date('2026-01-01T00:00:00Z'),
					whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1234'
				})
			]
		);
		expect(result.bottles).toEqual([
			{
				number: 1,
				tastingDate: '2021-05-07',
				distillery: 'Ardbeg',
				bottler: null,
				bottling: null,
				age: null,
				abv: 46,
				broughtBy: 'Cem (inaktiv)'
			},
			{
				number: 2,
				tastingDate: '2022-02-18',
				distillery: 'Ardbeg',
				bottler: null,
				bottling: null,
				age: null,
				abv: 46,
				broughtBy: 'Ben'
			}
		]);
	});
});

describe('buildStatistics – overview', () => {
	it('counts distilleries without Blend and Unbekannt, ignoring case', () => {
		const { overview, distilleries } = build(
			[T1],
			bottles('t1', 'Anna', ['Ardbeg', 'ardbeg ', 'BLEND', 'Blend', 'unbekannt', 'Lagavulin'])
		);
		expect(overview).toMatchObject({ tastings: 1, bottles: 6, distilleries: 2 });
		expect(distilleries.podium).toEqual([
			{ place: 1, count: 2, names: ['Ardbeg'] },
			{ place: 2, count: 1, names: ['Lagavulin'] }
		]);
		expect(distilleries.repeaters).toEqual([{ name: 'Ardbeg', count: 2 }]);
	});

	it('counts the known countries ignoring case, and the distilleries without one', () => {
		const { overview } = build(
			[T1],
			[
				bottle({ slot: 1, distillery: 'Ardbeg', country: 'Schottland' }),
				bottle({ slot: 2, distillery: 'Lagavulin', country: 'schottland' }),
				bottle({ slot: 3, distillery: 'Kavalan', country: 'Taiwan' }),
				bottle({ slot: 4, distillery: 'Penderyn', country: 'Wales' }),
				// Two bottles of one distillery without a country count once.
				bottle({ slot: 5, distillery: 'Mackmyra' }),
				bottle({ slot: 6, distillery: 'mackmyra' }),
				// The placeholders are no distillery, not even with a country.
				bottle({ slot: 7, distillery: 'Blend', country: 'Japan' }),
				bottle({ slot: 8, distillery: 'Unbekannt' })
			]
		);
		expect(overview).toMatchObject({ distilleries: 5, countries: 3, withoutCountry: 1 });
	});

	it('counts the countries by code like the world map: synonyms as one, unknown names as without', () => {
		const { overview } = build(
			[T1],
			[
				bottle({ slot: 1, distillery: 'Buffalo Trace', country: 'USA' }),
				bottle({ slot: 2, distillery: 'Balcones', country: 'Vereinigte Staaten' }),
				// No code: counts like a distillery without a country.
				bottle({ slot: 3, distillery: 'Ardbeg', country: 'Schotland' }),
				bottle({ slot: 4, distillery: 'Bushmills', country: 'Vereinigtes Königreich' })
			]
		);
		expect(overview).toMatchObject({ distilleries: 4, countries: 1, withoutCountry: 2 });
	});

	it('leaves NAS out of the age figures but counts it', () => {
		const { overview } = build(
			[T1],
			[
				bottle({ slot: 1, age: 10 }),
				bottle({ slot: 2, age: 24 }),
				bottle({ slot: 3, age: null }),
				bottle({ slot: 4, age: 5 })
			]
		);
		expect(overview).toMatchObject({
			meanAge: 13,
			nas: { count: 1, percent: 25 },
			totalAge: 39,
			oldest: { value: 24, number: 2, more: 0 }
		});
	});

	it('computes mean and median ABV', () => {
		const { overview } = build(
			[T1],
			[40, 45.9, 46, 54.9, 55, 66.6].map((abv, i) => bottle({ slot: i + 1, abv }))
		);
		expect(overview.meanAbv).toBeCloseTo(51.4, 5);
		expect(overview.medianAbv).toBeCloseTo(50.45, 5);
		expect(build([T1], [bottle({ abv: 50 })]).overview.medianAbv).toBe(50);
	});

	it('names the first record holder in standard order and counts the ties', () => {
		const { overview } = build(
			[T1, T2],
			[
				bottle({ tastingId: 't2', abv: 66.6, age: 24 }),
				bottle({ tastingId: 't1', slot: 1, abv: 50, age: 12 }),
				bottle({ tastingId: 't1', slot: 2, abv: 66.6, age: 24 }),
				bottle({ tastingId: 't1', slot: 3, abv: 66.6, age: null })
			]
		);
		expect(overview.strongest).toEqual({ value: 66.6, number: 2, more: 2 });
		expect(overview.oldest).toEqual({ value: 24, number: 2, more: 1 });
	});
});

describe('buildStatistics – pure alcohol', () => {
	it('sums the samples of every bottle per tasting – per person, whoever took part', () => {
		const { alcohol } = build(
			[T1, T2],
			[
				// 50 ml at 40 % and at 60 %: 20 + 30 ml pure alcohol per person.
				bottle({ tastingId: 't1', username: 'Anna', abv: 40 }),
				bottle({ tastingId: 't1', username: 'Ben', abv: 60 }),
				// 25 ml
				bottle({ tastingId: 't2', username: 'Anna', abv: 50 })
			]
		);
		expect(alcohol.pureMl).toBeCloseTo(75, 10);
		expect(alcohol.pureGrams).toBeCloseTo(75 * 0.789, 10);
		expect(alcohol.beers).toBeCloseTo(3, 10);
		expect(alcohol.liquidMl).toBe(150);
		expect(alcohol.whiskyBottles).toBeCloseTo(150 / 700, 10);
		expect(alcohol.hardest).toEqual({ tastingDate: '2021-05-07', pureMl: 50 });
	});
});

describe('buildStatistics – people', () => {
	it('compares the bringers with their shares and averages', () => {
		const { people } = build(
			[T1],
			[
				// ABVs relative to the cask strength level, one bottle of Ben's above it.
				bottle({
					username: 'Ben',
					slot: 1,
					abv: CASK_STRENGTH_ABV + 6,
					bottler: 'Signatory',
					age: 10
				}),
				bottle({ username: 'Ben', slot: 2, abv: CASK_STRENGTH_ABV - 4, age: null }),
				// Just below the cask strength level.
				bottle({ username: 'Anna', slot: 1, abv: CASK_STRENGTH_ABV - 0.1, age: 12 })
			]
		);
		expect(people.persons).toEqual([
			{
				name: 'Anna',
				bottles: 1,
				meanAbv: CASK_STRENGTH_ABV - 0.1,
				caskStrength: { count: 0, percent: 0 },
				independent: { count: 0, percent: 0 },
				meanAge: 12,
				nas: { count: 0, percent: 0 },
				uniqueDistilleries: 0,
				countries: 0,
				strongest: 1
			},
			{
				name: 'Ben',
				bottles: 2,
				meanAbv: CASK_STRENGTH_ABV + 1,
				caskStrength: { count: 1, percent: 50 },
				independent: { count: 1, percent: 50 },
				meanAge: 10,
				nas: { count: 1, percent: 50 },
				uniqueDistilleries: 0,
				countries: 0,
				strongest: 2
			}
		]);
		expect(people.best).toEqual({
			meanAbv: ['Ben'],
			caskStrength: ['Ben'],
			independent: ['Ben'],
			meanAge: ['Anna'],
			// All bottles are Ardbeg: nobody has a distillery of their own.
			uniqueDistilleries: [],
			// No country known at all.
			countries: []
		});
		expect(people.capacity).toBeNull();
	});

	it('counts a bottle from CASK_STRENGTH_ABV on as cask strength level', () => {
		const { people } = build(
			[T1],
			[
				bottle({ username: 'Anna', abv: CASK_STRENGTH_ABV }),
				bottle({ username: 'Ben', abv: CASK_STRENGTH_ABV - 0.1 })
			]
		);
		expect(people.persons.map((p) => p.caskStrength)).toEqual([
			{ count: 1, percent: 100 },
			{ count: 0, percent: 0 }
		]);
	});

	it('compares the averages at the precision shown, so ties name everybody', () => {
		const { people } = build(
			[T1],
			[
				bottle({ username: 'Anna', abv: 51.26 }),
				bottle({ username: 'Ben', abv: 51.34 }),
				bottle({ username: 'Cem', abv: 46 })
			]
		);
		expect(people.persons.map((p) => p.meanAbv)).toEqual([51.3, 51.3, 46]);
		expect(people.best.meanAbv).toEqual(['Anna', 'Ben']);
	});

	it('counts distilleries that occur exactly once overall, without Blend and Unbekannt', () => {
		const { people } = build(
			[T1, T2],
			[
				...bottles('t1', 'Anna', ['Ardbeg', 'Blend', 'Bunnahabhain', 'Kilchoman']),
				...bottles('t2', 'Ben', ['bunnahabhain', 'Caol Ila', 'unbekannt', 'Deanston']),
				...bottles('t2', 'Cem', ['Unbekannt', 'blend'])
			]
		);
		// Bunnahabhain twice (case ignored); the placeholders never count.
		expect(people.persons.map((p) => [p.name, p.uniqueDistilleries])).toEqual([
			['Anna', 2],
			['Ben', 2],
			['Cem', 0]
		]);
		expect(people.best.uniqueDistilleries).toEqual(['Anna', 'Ben']);
	});
});

describe('buildStatistics – countries and capacities', () => {
	it('counts the different countries per bringer and names the most', () => {
		const { people } = build(
			[T1],
			[
				bottle({ username: 'Anna', slot: 1, distillery: 'Ardbeg', country: 'Schottland' }),
				bottle({ username: 'Anna', slot: 2, distillery: 'Lagavulin', country: 'schottland' }),
				bottle({ username: 'Anna', slot: 3, distillery: 'Kavalan', country: 'Taiwan' }),
				bottle({ username: 'Ben', slot: 1, distillery: 'Penderyn', country: 'Wales' }),
				bottle({ username: 'Ben', slot: 2, distillery: 'Amrut', country: 'Indien' }),
				bottle({ username: 'Cem', slot: 1, distillery: 'Blend', country: 'Japan' }),
				bottle({ username: 'Cem', slot: 2, distillery: 'Mackmyra' })
			]
		);
		expect(people.persons.map((p) => [p.name, p.countries])).toEqual([
			['Anna', 2],
			['Ben', 2],
			['Cem', 0]
		]);
		expect(people.best.countries).toEqual(['Anna', 'Ben']);
	});

	it('counts no country per bringer for a name without a code', () => {
		const { people } = build(
			[T1],
			[
				bottle({ username: 'Anna', slot: 1, distillery: 'Ardbeg', country: 'Schotland' }),
				bottle({ username: 'Ben', slot: 1, distillery: 'Kavalan', country: 'Taiwan' })
			]
		);
		expect(people.persons.map((p) => [p.name, p.countries])).toEqual([
			['Anna', 0],
			['Ben', 1]
		]);
		expect(people.best.countries).toEqual(['Ben']);
	});

	it('names the largest and the smallest distillery with everybody who brought one', () => {
		const { people } = build(
			[T1, T2],
			[
				bottle({ tastingId: 't1', username: 'Cem', distillery: 'Glenfiddich', capacity: 21e6 }),
				bottle({ tastingId: 't1', username: 'Anna', distillery: 'Ardbeg', capacity: 2.4e6 }),
				bottle({ tastingId: 't2', username: 'Ben', distillery: 'glenfiddich ', capacity: 21e6 }),
				// Same size, another distillery: both are named.
				bottle({ tastingId: 't2', username: 'Anna', distillery: 'Daftmill', capacity: 65_000 }),
				bottle({
					tastingId: 't2',
					username: 'Anna',
					slot: 2,
					distillery: 'Abhainn Dearg',
					capacity: 65_000
				}),
				bottle({ tastingId: 't2', username: 'Ben', slot: 2, distillery: 'Mackmyra' }),
				// The placeholders never count, even with a capacity.
				bottle({ tastingId: 't2', username: 'Cem', distillery: 'Blend', capacity: 100e6 }),
				bottle({ tastingId: 't2', username: 'Cem', slot: 2, distillery: 'Unbekannt', capacity: 1 })
			]
		);
		expect(people.capacity).toEqual({
			// The first spelling in standard order, the bringers alphabetically.
			largest: { capacity: 21e6, distilleries: ['Glenfiddich'], persons: ['Ben', 'Cem'] },
			smallest: { capacity: 65_000, distilleries: ['Abhainn Dearg', 'Daftmill'], persons: ['Anna'] }
		});
	});

	it('names no largest and smallest distillery without two different capacities', () => {
		const capacity = (inputs: StatisticsBottleInput[]) => build([T1], inputs).people.capacity;
		expect(capacity([bottle({ capacity: null })])).toBeNull();
		expect(capacity(bottles('t1', 'Anna', ['Ardbeg', 'Lagavulin'], { capacity: 2e6 }))).toBeNull();
		expect(
			capacity([
				bottle({ username: 'Anna', distillery: 'Ardbeg', capacity: 2e6 }),
				bottle({ username: 'Ben', distillery: 'Lagavulin', capacity: 3e6 })
			])
		).toEqual({
			largest: { capacity: 3e6, distilleries: ['Lagavulin'], persons: ['Ben'] },
			smallest: { capacity: 2e6, distilleries: ['Ardbeg'], persons: ['Anna'] }
		});
	});
});

describe('buildStatistics – distilleries and bottlers', () => {
	it('shares podium places on ties and gives the next place to the next lower count', () => {
		const { distilleries } = build(
			[T1],
			bottles('t1', 'Anna', [
				'BenRiach',
				'Bunnahabhain',
				'BenRiach',
				'Bunnahabhain',
				'Ardbeg',
				'Lagavulin',
				'Deanston',
				'BenRiach',
				'Bunnahabhain',
				'Laphroaig',
				'Laphroaig'
			])
		);
		expect(distilleries.podium).toEqual([
			{ place: 1, count: 3, names: ['BenRiach', 'Bunnahabhain'] },
			{ place: 2, count: 2, names: ['Laphroaig'] },
			{ place: 3, count: 1, names: ['Ardbeg', 'Deanston', 'Lagavulin'] }
		]);
		expect(distilleries.repeaters).toEqual([
			{ name: 'BenRiach', count: 3 },
			{ name: 'Bunnahabhain', count: 3 },
			{ name: 'Laphroaig', count: 2 }
		]);
	});

	it('splits original and independent bottlings and names the top bottlers', () => {
		const { distilleries } = build(
			[T1],
			[
				bottle({ slot: 1, bottler: 'Signatory' }),
				bottle({ slot: 2, bottler: 'signatory' }),
				bottle({ slot: 3, bottler: 'Gordon & MacPhail' }),
				bottle({ slot: 4, bottler: 'Gordon & MacPhail' }),
				bottle({ slot: 5, bottler: 'Hunter Laing' }),
				bottle({ slot: 6, bottler: null })
			]
		);
		expect(distilleries).toMatchObject({
			original: 1,
			independent: 5,
			topBottlers: { names: ['Gordon & MacPhail', 'Signatory'], count: 2 }
		});
		expect(build([T1], [bottle()]).distilleries.topBottlers).toBeNull();
	});

	it('finds the same Whiskybase whisky in several tastings, with and without www', () => {
		const { distilleries } = build(
			[T1, T2, T3],
			[
				bottle({
					tastingId: 't2',
					distillery: 'Kavalan',
					bottling: 'Oloroso Sherry Oak',
					whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1234/kavalan'
				}),
				bottle({
					tastingId: 't3',
					distillery: 'Kavalan',
					bottling: 'Oloroso Sherry Oak',
					whiskybaseUrl: 'https://whiskybase.com/whiskies/whisky/1234'
				}),
				// Twice in one tasting is no déjà-vu.
				bottle({
					tastingId: 't1',
					slot: 1,
					whiskybaseUrl: 'https://whiskybase.com/whiskies/whisky/9'
				}),
				bottle({
					tastingId: 't1',
					slot: 2,
					whiskybaseUrl: 'https://whiskybase.com/whiskies/whisky/9'
				}),
				bottle({ tastingId: 't3', slot: 2, whiskybaseUrl: null })
			]
		);
		expect(distilleries.dejaVu).toEqual([
			{ name: 'Kavalan Oloroso Sherry Oak', dates: ['2022-02-18', '2024-09-27'] }
		]);
	});
});

describe('buildStatistics – timeline', () => {
	it('averages per tasting, an age only without NAS', () => {
		const { timeline } = build(
			[T1, T2, T3],
			[
				bottle({ tastingId: 't1', slot: 1, abv: 40, age: 10 }),
				bottle({ tastingId: 't1', slot: 2, abv: 50, age: null }),
				bottle({ tastingId: 't2', slot: 1, abv: 60, age: null })
			]
		);
		expect(timeline.tastings).toEqual([
			{ tastingDate: '2021-05-07', meanAbv: 45, meanAge: 10 },
			// Only NAS: no point in the age chart.
			{ tastingDate: '2022-02-18', meanAbv: 60, meanAge: null },
			// No bottles at all.
			{ tastingDate: '2024-09-27', meanAbv: null, meanAge: null }
		]);
	});

	it('counts tastings per year, empty years included, and finds the longest break', () => {
		const { timeline } = build([T1, { id: 't1b', tastingDate: '2021-11-26' }, T2, T3], []);
		expect(timeline.perYear).toEqual([
			{ year: 2021, count: 2 },
			{ year: 2022, count: 1 },
			{ year: 2023, count: 0 },
			{ year: 2024, count: 1 }
		]);
		expect(timeline.longestBreak).toEqual({ days: 952, from: '2022-02-18', to: '2024-09-27' });
		expect(build([T1], []).timeline.longestBreak).toBeNull();
	});

	it('marks the first and every 50th bottle as a milestone', () => {
		const many = Array.from({ length: 101 }, (_, i) =>
			bottle({ slot: (i % 6) + 1, username: `user${String(Math.floor(i / 6)).padStart(2, '0')}` })
		);
		expect(build([T1], many).timeline.milestones).toEqual([1, 50, 100]);
	});
});

describe('buildStatistics – revealed tastings without bottles', () => {
	it('computes nothing from empty lists (no NaN, no Infinity)', () => {
		const result = build([T1], []);
		expect(result.bottles).toEqual([]);
		expect(result.overview).toEqual({
			tastings: 1,
			bottles: 0,
			distilleries: 0,
			countries: 0,
			withoutCountry: 0,
			meanAbv: null,
			medianAbv: null,
			meanAge: null,
			nas: { count: 0, percent: 0 },
			totalAge: 0,
			strongest: null,
			oldest: null
		});
		expect(result.alcohol).toEqual({
			pureMl: 0,
			pureGrams: 0,
			beers: 0,
			liquidMl: 0,
			whiskyBottles: 0,
			hardest: null
		});
		expect(result.people).toEqual({
			persons: [],
			best: {
				meanAbv: [],
				caskStrength: [],
				independent: [],
				meanAge: [],
				uniqueDistilleries: [],
				countries: []
			},
			capacity: null
		});
		expect(result.distilleries).toEqual({
			podium: [],
			repeaters: [],
			original: 0,
			independent: 0,
			topBottlers: null,
			dejaVu: []
		});
		expect(result.timeline.milestones).toEqual([]);
	});
});
