// Search, filters and sorting of the history's bottle table. The state lives
// in the query string, so a link keeps it; the page derives it from the URL on
// every change. Client-safe like tasting.ts.

import { formatBottleName, formatDate, formatOneDecimal, type HistoryBottle } from '$lib/tasting';

export const SORT_KEYS = ['whisky', 'date', 'broughtBy', 'alias', 'bottler', 'age', 'abv'] as const;

/** The sortable columns – every column except the links. */
export type SortKey = (typeof SORT_KEYS)[number];

export type SortDirection = 'asc' | 'desc';

/** Column headings, also the options of the mobile "Sortieren nach". */
export const COLUMN_LABELS: Record<SortKey, string> = {
	whisky: 'Whisky',
	date: 'Datum',
	broughtBy: 'Mitgebracht von',
	alias: 'Synonym',
	bottler: 'Abfüller',
	age: 'Alter',
	abv: 'Alkohol'
};

/** From this many characters on, the search filters the table. */
export const SEARCH_MIN_LENGTH = 3;

/** Longer searches in the URL are ignored. */
export const SEARCH_MAX_LENGTH = 100;

export type TableQuery = {
	/** As typed – trimmed only for the comparison, so spaces can be typed. */
	q: string;
	sort: SortKey;
	dir: SortDirection;
	year: string | null;
	/** A bringer as shown in "Mitgebracht von". */
	by: string | null;
};

/** Newest tasting first, everything shown. Never written to the URL. */
export const DEFAULT_QUERY: TableQuery = { q: '', sort: 'date', dir: 'desc', year: null, by: null };

/** What the filters offer – and the only values they take from the URL. */
export type FilterOptions = { years: string[]; people: string[] };

const text = new Intl.Collator('de');
// P2 < P21 < P113
const natural = new Intl.Collator('de', { numeric: true });

export function filterOptions(bottles: HistoryBottle[]): FilterOptions {
	return {
		years: [...new Set(bottles.map((b) => b.tastingDate.slice(0, 4)))].sort().reverse(),
		people: [...new Set(bottles.map((b) => b.broughtBy))].sort(text.compare)
	};
}

function isSortKey(value: string | null): value is SortKey {
	return (SORT_KEYS as readonly (string | null)[]).includes(value);
}

/**
 * The table state from the query string. Each parameter is checked against
 * its whitelist on its own; anything else silently falls back to the default.
 */
export function parseTableQuery(params: URLSearchParams, options: FilterOptions): TableQuery {
	const q = params.get('q') ?? '';
	const sort = params.get('sort');
	const dir = params.get('dir');
	const year = params.get('year');
	const by = params.get('by');
	return {
		q: q.length <= SEARCH_MAX_LENGTH ? q : DEFAULT_QUERY.q,
		sort: isSortKey(sort) ? sort : DEFAULT_QUERY.sort,
		dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_QUERY.dir,
		year: year !== null && options.years.includes(year) ? year : DEFAULT_QUERY.year,
		by: by !== null && options.people.includes(by) ? by : DEFAULT_QUERY.by
	};
}

/** The query string of a table state, without the defaults ('' for none). */
export function tableQueryString(query: TableQuery): string {
	const params = new URLSearchParams();
	if (query.q) params.set('q', query.q);
	if (query.by !== null) params.set('by', query.by);
	if (query.year !== null) params.set('year', query.year);
	if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort);
	if (query.dir !== DEFAULT_QUERY.dir) params.set('dir', query.dir);
	return params.toString();
}

/**
 * Id of a bottle's table row, the target of the statistics' links to it.
 * Without a query string, so neither search nor filters hide the row.
 */
export function bottleAnchor(number: number): string {
	return `bottle-${number}`;
}

function bottlerText(bottle: HistoryBottle): string {
	return bottle.bottler ?? 'Originalabfüllung';
}

/**
 * The text of every sortable column as the table shows it – the cells render
 * it and the search compares with it, so both always agree. The whisky goes
 * without the bottler, which has a column of its own.
 */
export function bottleCells(bottle: HistoryBottle): Record<SortKey, string> {
	return {
		whisky: formatBottleName({ ...bottle, bottler: null }),
		date: formatDate(bottle.tastingDate),
		broughtBy: bottle.broughtBy,
		alias: bottle.alias,
		bottler: bottlerText(bottle),
		age: bottle.age === null ? 'NAS' : `${bottle.age} Jahre`,
		abv: `${formatOneDecimal(bottle.abv)} %`
	};
}

/** Search (from SEARCH_MIN_LENGTH characters on), bringer and year together. */
export function filterBottles(bottles: HistoryBottle[], query: TableQuery): HistoryBottle[] {
	const needle = query.q.trim().toLocaleLowerCase('de-DE');
	return bottles.filter(
		(bottle) =>
			(query.by === null || bottle.broughtBy === query.by) &&
			(query.year === null || bottle.tastingDate.startsWith(query.year)) &&
			(needle.length < SEARCH_MIN_LENGTH ||
				// One line per column, so a match can't span two of them.
				Object.values(bottleCells(bottle)).join('\n').toLocaleLowerCase('de-DE').includes(needle))
	);
}

const COMPARE: Record<SortKey, (a: HistoryBottle, b: HistoryBottle) => number> = {
	whisky: (a, b) => text.compare(a.distillery, b.distillery),
	date: (a, b) => (a.tastingDate < b.tastingDate ? -1 : a.tastingDate > b.tastingDate ? 1 : 0),
	broughtBy: (a, b) => text.compare(a.broughtBy, b.broughtBy),
	alias: (a, b) => natural.compare(a.alias, b.alias),
	bottler: (a, b) => text.compare(bottlerText(a), bottlerText(b)),
	age: (a, b) => (a.age ?? 0) - (b.age ?? 0),
	abv: (a, b) => a.abv - b.abv
};

/**
 * Sorted by one column in either direction. Stable: on a tie the given
 * (default) order stays. NAS stays at the end in both directions.
 */
export function sortBottles(
	bottles: HistoryBottle[],
	sort: SortKey,
	dir: SortDirection
): HistoryBottle[] {
	const sign = dir === 'asc' ? 1 : -1;
	return [...bottles].sort((a, b) => {
		if (sort === 'age' && (a.age === null || b.age === null)) {
			return Number(a.age === null) - Number(b.age === null);
		}
		return sign * COMPARE[sort](a, b);
	});
}
