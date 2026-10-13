import { describe, it, expect } from 'vitest';
import type { StatisticsBottle } from './tasting';
import {
	bottleAnchor,
	bottleCells,
	DEFAULT_QUERY,
	filterBottles,
	filterOptions,
	linkQueryString,
	parseTableQuery,
	SEARCH_MAX_LENGTH,
	sortBottles,
	tableQueryString,
	type TableQuery
} from './statisticsTable';

function bottle(number: number, overrides: Partial<StatisticsBottle> = {}): StatisticsBottle {
	return {
		number,
		tastingDate: '2022-10-21',
		slug: null,
		alias: `P${number}`,
		distillery: 'Ardbeg',
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		whiskybaseUrl: null,
		broughtBy: 'Anna',
		presentation: null,
		...overrides
	};
}

// In the table's default order: newest tasting first.
const BOTTLES = [
	bottle(4, {
		tastingDate: '2024-09-27',
		alias: 'P113',
		distillery: 'Deanston',
		age: 12,
		abv: 66.6,
		bottler: 'Signatory',
		bottling: '2008/2022',
		broughtBy: 'Ben'
	}),
	bottle(5, {
		tastingDate: '2024-09-27',
		alias: 'P21',
		distillery: 'ardbeg',
		abv: 54.1,
		broughtBy: 'Ben'
	}),
	bottle(1, {
		tastingDate: '2021-05-07',
		alias: 'P2',
		distillery: 'Glen Spey',
		age: 24,
		abv: 46,
		bottler: 'Hunter Laing',
		broughtBy: 'Cem (inaktiv)'
	}),
	bottle(2, {
		tastingDate: '2021-05-07',
		alias: 'p10',
		distillery: 'BenRiach',
		age: 8,
		abv: 43,
		broughtBy: 'Anna'
	})
];

const OPTIONS = filterOptions(BOTTLES);

function query(overrides: Partial<TableQuery> = {}): TableQuery {
	return { ...DEFAULT_QUERY, ...overrides };
}

const numbers = (bottles: StatisticsBottle[]) => bottles.map((b) => b.number);

describe('filterOptions', () => {
	it('offers the years newest first and the bringers alphabetically', () => {
		expect(OPTIONS).toEqual({ years: ['2024', '2021'], people: ['Anna', 'Ben', 'Cem (inaktiv)'] });
	});
});

describe('parseTableQuery and tableQueryString', () => {
	it('reads every parameter', () => {
		const params = new URLSearchParams('q=ard&by=Ben&year=2024&sort=abv&dir=asc');
		expect(parseTableQuery(params, OPTIONS)).toEqual({
			q: 'ard',
			by: 'Ben',
			year: '2024',
			sort: 'abv',
			dir: 'asc'
		});
	});

	it('falls back to the default for each invalid parameter on its own', () => {
		const params = new URLSearchParams(
			`q=${'x'.repeat(SEARCH_MAX_LENGTH + 1)}&by=Mallory&year=1999&sort=score&dir=up`
		);
		expect(parseTableQuery(params, OPTIONS)).toEqual(DEFAULT_QUERY);
		expect(
			parseTableQuery(new URLSearchParams('sort=toString&dir=desc&year=2021'), OPTIONS)
		).toEqual(query({ year: '2021' }));
	});

	it('keeps the search as typed, up to the maximum length', () => {
		const q = ` ${'x'.repeat(SEARCH_MAX_LENGTH - 2)} `;
		expect(parseTableQuery(new URLSearchParams({ q }), OPTIONS).q).toBe(q);
	});

	it('writes only what differs from the default and reads it back', () => {
		expect(tableQueryString(DEFAULT_QUERY)).toBe('');
		const state = query({ q: 'P2 (', by: 'Cem (inaktiv)', sort: 'alias', dir: 'asc' });
		const written = tableQueryString(state);
		expect(written).toBe('q=P2+%28&by=Cem+%28inaktiv%29&sort=alias&dir=asc');
		expect(parseTableQuery(new URLSearchParams(written), OPTIONS)).toEqual(state);
	});

	it('keeps only the sorting in links to a row', () => {
		expect(linkQueryString(query({ q: 'ard', by: 'Ben', year: '2024', sort: 'abv' }))).toBe(
			'sort=abv'
		);
		expect(linkQueryString(query({ q: 'ard' }))).toBe('');
		expect(bottleAnchor(7)).toBe('bottle-7');
	});
});

describe('bottleCells', () => {
	it('renders every column as shown, the whisky without the bottler', () => {
		expect(bottleCells(BOTTLES[0])).toEqual({
			whisky: 'Deanston 12 Jahre 2008/2022',
			date: '27.09.2024',
			broughtBy: 'Ben',
			alias: 'P113',
			bottler: 'Signatory',
			age: '12 Jahre',
			abv: '66,6 %'
		});
		expect(bottleCells(BOTTLES[1])).toMatchObject({ bottler: 'Originalabfüllung', age: 'NAS' });
	});
});

describe('filterBottles', () => {
	it('ignores searches shorter than three characters', () => {
		expect(numbers(filterBottles(BOTTLES, query({ q: 'ar' })))).toEqual([4, 5, 1, 2]);
		expect(numbers(filterBottles(BOTTLES, query({ q: '   ar  ' })))).toEqual([4, 5, 1, 2]);
	});

	it.each([
		['the whisky', 'ARDB', [5]],
		['the date', '07.05.', [1, 2]],
		['the bringer', 'inaktiv', [1]],
		['the alias', 'p11', [4]],
		['the bottler', 'originalabf', [5, 2]],
		['NAS', 'nas', [5]],
		['the age', '24 Jahre', [1]],
		['the ABV as shown', '54,1 %', [5]]
	])('finds %s, ignoring case', (_label, q, expected) => {
		expect(numbers(filterBottles(BOTTLES, query({ q })))).toEqual(expected);
	});

	it('matches within one column only', () => {
		// "Ben" + line break + "P113" – never across two columns.
		expect(filterBottles(BOTTLES, query({ q: 'benp113' }))).toEqual([]);
	});

	it('combines the search with the bringer and the year', () => {
		expect(numbers(filterBottles(BOTTLES, query({ by: 'Ben' })))).toEqual([4, 5]);
		expect(numbers(filterBottles(BOTTLES, query({ year: '2021' })))).toEqual([1, 2]);
		expect(
			numbers(filterBottles(BOTTLES, query({ q: 'ardbeg', by: 'Ben', year: '2024' })))
		).toEqual([5]);
		expect(filterBottles(BOTTLES, query({ q: 'ardbeg', year: '2021' }))).toEqual([]);
	});
});

describe('sortBottles', () => {
	it.each([
		['whisky', [5, 2, 4, 1]],
		['date', [1, 2, 4, 5]],
		['broughtBy', [2, 4, 5, 1]],
		['alias', [1, 2, 5, 4]],
		['bottler', [1, 5, 2, 4]],
		['abv', [2, 1, 5, 4]]
	] as const)('sorts by %s ascending', (sort, expected) => {
		expect(numbers(sortBottles(BOTTLES, sort, 'asc'))).toEqual(expected);
	});

	it('reverses the direction, ties keep the default order', () => {
		expect(numbers(sortBottles(BOTTLES, 'date', 'desc'))).toEqual([4, 5, 1, 2]);
		expect(numbers(sortBottles(BOTTLES, 'abv', 'desc'))).toEqual([4, 5, 1, 2]);
		// Two tastings, two bringers each: the default order inside the tasting stays.
		expect(numbers(sortBottles(BOTTLES, 'date', 'asc'))).toEqual([1, 2, 4, 5]);
	});

	it('sorts aliases naturally (P2 < p10 < P21 < P113)', () => {
		expect(sortBottles(BOTTLES, 'alias', 'asc').map((b) => b.alias)).toEqual([
			'P2',
			'p10',
			'P21',
			'P113'
		]);
	});

	it('keeps NAS at the end in both directions', () => {
		expect(numbers(sortBottles(BOTTLES, 'age', 'asc'))).toEqual([2, 4, 1, 5]);
		expect(numbers(sortBottles(BOTTLES, 'age', 'desc'))).toEqual([1, 4, 2, 5]);
	});

	it('leaves the input untouched', () => {
		sortBottles(BOTTLES, 'abv', 'asc');
		expect(numbers(BOTTLES)).toEqual([4, 5, 1, 2]);
	});
});
