// Aggregation of the statistics page over all revealed tastings. Pure
// functions without database access: getStatistics() in tastings.ts decides
// which tastings count and which fields leave the server, this module only
// computes with what it gets.

import {
	BEER_PURE_ALCOHOL_ML,
	CASK_STRENGTH_ABV,
	ETHANOL_DENSITY,
	formatBottleName,
	MILESTONE_STEP,
	participantLabel,
	SAMPLE_SIZE_ML,
	WHISKY_BOTTLE_ML,
	type BottleRecord,
	type CapacityRecord,
	type PersonMetric,
	type PersonStatistics,
	type Share,
	type Statistics,
	type StatisticsBottle
} from '$lib/tasting';
import { whiskybaseId } from '$lib/validation';
import { countryCode } from '$lib/countries';
import {
	groupByName,
	isPlaceholderDistillery,
	nameKey,
	PLACEHOLDER_DISTILLERIES
} from '$lib/distilleryNames';

/** A revealed tasting, in date order. */
export type StatisticsTastingInput = { id: string; tastingDate: string };

/**
 * A bottle of a revealed tasting with the fields the statistics may use. The
 * Whiskybase link only finds the déjà-vus, it doesn't leave the server; nor
 * do country and capacity, the known facts of the bottle's distillery (`null`
 * while not known), which only leave it aggregated.
 */
export type StatisticsBottleInput = {
	tastingId: string;
	slot: number;
	distillery: string;
	bottler: string | null;
	bottling: string | null;
	age: number | null;
	abv: number;
	whiskybaseUrl: string | null;
	country: string | null;
	capacity: number | null;
	username: string;
	deactivatedAt: Date | null;
};

/** A bottle with its place in the standard order, see numberBottles(). */
export type Numbered<T> = T & { number: number; tastingIndex: number };

/**
 * The bottles in standard order: by tasting, then by bringer (compared here,
 * SQLite only compares bytes) and slot – like the reveal of an archived
 * tasting. `number` counts from 1: the anchor of the history's table row
 * (`#bottle-<number>`) and the count of the milestones, so the statistics and
 * the history must number the same way. `tastings` must be in date order
 * (same-day tastings in creation order); the bottles may come in any order.
 */
export function numberBottles<T extends { tastingId: string; username: string; slot: number }>(
	tastings: ReadonlyArray<{ id: string }>,
	bottles: T[]
): Array<Numbered<T>> {
	const tastingIndex = new Map(tastings.map((t, index) => [t.id, index]));
	return bottles
		.map((bottle) => ({ bottle, tastingIndex: tastingIndex.get(bottle.tastingId)! }))
		.sort(
			(a, b) =>
				a.tastingIndex - b.tastingIndex ||
				a.bottle.username.localeCompare(b.bottle.username, 'de-DE') ||
				a.bottle.slot - b.bottle.slot
		)
		.map(({ bottle, tastingIndex }, i) => ({ ...bottle, number: i + 1, tastingIndex }));
}

const collator = new Intl.Collator('de');

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number | null {
	return values.length > 0 ? sum(values) / values.length : null;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One decimal: the precision the page shows and the highlighting compares. */
function round1(value: number | null): number | null {
	return value === null ? null : Math.round(value * 10) / 10;
}

function share(count: number, total: number): Share {
	return { count, percent: total > 0 ? Math.round((count / total) * 100) : 0 };
}

/** The names with the highest count, alphabetically. */
function namesWithCount(groups: Array<{ name: string; count: number }>, count: number): string[] {
	return groups
		.filter((group) => group.count === count)
		.map((group) => group.name)
		.sort(collator.compare);
}

type Entry = {
	bottle: StatisticsBottle;
	input: Numbered<StatisticsBottleInput>;
	tastingIndex: number;
};

function record(entries: Entry[], value: (entry: Entry) => number): BottleRecord | null {
	if (entries.length === 0) return null;
	const max = Math.max(...entries.map(value));
	const holders = entries.filter((entry) => value(entry) === max);
	return { value: max, number: holders[0].bottle.number, more: holders.length - 1 };
}

/**
 * The country code of the bottle's distillery (countryCode(): the same mapping
 * as the world map, so both count the same countries). `null` while unknown,
 * for a name without a code and for the placeholders, which are no distillery.
 */
function countryKey(entry: Entry): string | null {
	const { distillery, country } = entry.input;
	return country === null || isPlaceholderDistillery(distillery) ? null : countryCode(country);
}

function countries(entries: Entry[]): number {
	return new Set(entries.flatMap((entry) => countryKey(entry) ?? [])).size;
}

/**
 * Largest and smallest distillery by known capacity. Only with at least two
 * different capacities – with a single one, the same distillery would be both.
 */
function capacity(entries: Entry[]): Statistics['people']['capacity'] {
	const sized = entries.filter(
		(entry) => entry.input.capacity !== null && !isPlaceholderDistillery(entry.input.distillery)
	);
	const capacities = sized.map((entry) => entry.input.capacity!);
	if (new Set(capacities).size < 2) return null;

	const holders = (value: number): CapacityRecord => {
		const same = sized.filter((entry) => entry.input.capacity === value);
		return {
			capacity: value,
			distilleries: groupByName(same.map((entry) => entry.input.distillery))
				.map((group) => group.name)
				.sort(collator.compare),
			persons: [...new Set(same.map((entry) => entry.bottle.broughtBy))].sort(collator.compare)
		};
	};
	return { largest: holders(Math.max(...capacities)), smallest: holders(Math.min(...capacities)) };
}

function daysBetween(from: string, to: string): number {
	return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

function people(entries: Entry[], distilleryCounts: Map<string, number>): Statistics['people'] {
	const byPerson = Map.groupBy(entries, (entry) => entry.bottle.broughtBy);

	const persons = [...byPerson.entries()]
		.sort(([a], [b]) => collator.compare(a, b))
		.map(([name, own]): PersonStatistics => {
			const abvs = own.map((entry) => entry.input.abv);
			const ages = own.flatMap((entry) => (entry.input.age === null ? [] : [entry.input.age]));
			const strongestAbv = Math.max(...abvs);
			return {
				name,
				bottles: own.length,
				meanAbv: round1(mean(abvs)),
				caskStrength: share(abvs.filter((abv) => abv >= CASK_STRENGTH_ABV).length, own.length),
				independent: share(own.filter((entry) => entry.input.bottler !== null).length, own.length),
				meanAge: round1(mean(ages)),
				nas: share(own.length - ages.length, own.length),
				uniqueDistilleries: own.filter(
					(entry) =>
						!isPlaceholderDistillery(entry.input.distillery) &&
						distilleryCounts.get(nameKey(entry.input.distillery)) === 1
				).length,
				countries: countries(own),
				strongest: own.find((entry) => entry.input.abv === strongestAbv)!.bottle.number
			};
		});

	const values: Record<PersonMetric, (person: PersonStatistics) => number | null> = {
		meanAbv: (person) => person.meanAbv,
		caskStrength: (person) => person.caskStrength.percent,
		independent: (person) => person.independent.percent,
		meanAge: (person) => person.meanAge,
		uniqueDistilleries: (person) => person.uniqueDistilleries,
		countries: (person) => person.countries
	};
	// Ties name everybody; 0 or no value at all is nobody's best (otherwise
	// everyone without an independent bottler would be the "Indie-Scout").
	const best = Object.fromEntries(
		Object.entries(values).map(([metric, value]) => {
			const max = Math.max(...persons.map((person) => value(person) ?? 0));
			const names = max > 0 ? persons.filter((p) => value(p) === max).map((p) => p.name) : [];
			return [metric, names];
		})
	) as Record<PersonMetric, string[]>;

	return { persons, best, capacity: capacity(entries) };
}

function distilleries(entries: Entry[], tastings: StatisticsTastingInput[]) {
	const groups = groupByName(
		entries.map((entry) => entry.input.distillery).filter((name) => !isPlaceholderDistillery(name))
	);
	// Dense ranking: several distilleries on one place don't push the next
	// count off the podium.
	const counts = [...new Set(groups.map((group) => group.count))].sort((a, b) => b - a);
	const podium = counts.slice(0, 3).map((count, i) => ({
		place: i + 1,
		count,
		names: namesWithCount(groups, count)
	}));
	const repeaters = groups
		.filter((group) => group.count > 1)
		.sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));

	const bottlers = groupByName(entries.flatMap((entry) => entry.input.bottler ?? []));
	const topCount = Math.max(0, ...bottlers.map((group) => group.count));

	const byWhisky = Map.groupBy(entries, (entry) =>
		entry.input.whiskybaseUrl ? whiskybaseId(entry.input.whiskybaseUrl) : null
	);
	byWhisky.delete(null);
	const dejaVu = [...byWhisky.values()].flatMap((same) => {
		const indexes = [...new Set(same.map((entry) => entry.tastingIndex))];
		return indexes.length > 1
			? [
					{
						name: formatBottleName(same[0].input),
						dates: indexes.map((index) => tastings[index].tastingDate)
					}
				]
			: [];
	});

	const independent = entries.filter((entry) => entry.input.bottler !== null).length;
	return {
		podium,
		repeaters,
		original: entries.length - independent,
		independent,
		topBottlers:
			topCount > 0 ? { names: namesWithCount(bottlers, topCount), count: topCount } : null,
		dejaVu
	};
}

function timeline(entries: Entry[], tastings: StatisticsTastingInput[]): Statistics['timeline'] {
	const perTasting = tastings.map((t, index) => {
		const own = entries.filter((entry) => entry.tastingIndex === index);
		return {
			tastingDate: t.tastingDate,
			meanAbv: mean(own.map((entry) => entry.input.abv)),
			meanAge: mean(own.flatMap((entry) => (entry.input.age === null ? [] : [entry.input.age])))
		};
	});

	const years = tastings.map((t) => Number(t.tastingDate.slice(0, 4)));
	const perYear =
		years.length === 0
			? []
			: Array.from({ length: years[years.length - 1] - years[0] + 1 }, (_, i) => {
					const year = years[0] + i;
					return { year, count: years.filter((y) => y === year).length };
				});

	let longestBreak: Statistics['timeline']['longestBreak'] = null;
	for (let i = 1; i < tastings.length; i++) {
		const days = daysBetween(tastings[i - 1].tastingDate, tastings[i].tastingDate);
		if (days > (longestBreak?.days ?? 0)) {
			longestBreak = { days, from: tastings[i - 1].tastingDate, to: tastings[i].tastingDate };
		}
	}

	const milestones = entries
		.map((entry) => entry.bottle.number)
		.filter((number) => number === 1 || number % MILESTONE_STEP === 0);

	return { tastings: perTasting, perYear, longestBreak, milestones };
}

/**
 * Everything the statistics page shows. `tastings` must be in date order
 * (same-day tastings in creation order), the bottles as numberBottles()
 * returns them for these tastings.
 */
export function buildStatistics(
	tastings: StatisticsTastingInput[],
	bottles: Array<Numbered<StatisticsBottleInput>>
): Statistics {
	const entries: Entry[] = bottles.map((input) => {
		// Picked explicitly, never spread: the input's fields aren't all for the page.
		const bottle: StatisticsBottle = {
			number: input.number,
			tastingDate: tastings[input.tastingIndex].tastingDate,
			distillery: input.distillery,
			bottler: input.bottler,
			bottling: input.bottling,
			age: input.age,
			abv: input.abv,
			broughtBy: participantLabel(input.username, input.deactivatedAt)
		};
		return { bottle, input, tastingIndex: input.tastingIndex };
	});

	const abvs = entries.map((entry) => entry.input.abv);
	const aged = entries.filter((entry) => entry.input.age !== null);
	const ages = aged.map((entry) => entry.input.age!);

	const distilleryCounts = new Map<string, number>();
	for (const entry of entries) {
		const key = nameKey(entry.input.distillery);
		distilleryCounts.set(key, (distilleryCounts.get(key) ?? 0) + 1);
	}
	// The facts belong to the distillery: all its bottles share them.
	const withoutCountry = new Set(
		entries
			.filter(
				(entry) => !isPlaceholderDistillery(entry.input.distillery) && countryKey(entry) === null
			)
			.map((entry) => nameKey(entry.input.distillery))
	).size;

	// Pure alcohol per person: per tasting, the whole round drinks one sample
	// of every bottle per participant, divided by the number of participants
	// of that tasting. The participants cancel out, the sum of the samples of
	// all bottles remains – what somebody who was always there drank.
	const pureMlPerTasting = tastings.map((_, index) =>
		sum(
			entries
				.filter((entry) => entry.tastingIndex === index)
				.map((entry) => (SAMPLE_SIZE_ML * entry.input.abv) / 100)
		)
	);
	const pureMl = sum(pureMlPerTasting);
	const hardestIndex = pureMlPerTasting.indexOf(Math.max(...pureMlPerTasting));
	const liquidMl = entries.length * SAMPLE_SIZE_ML;

	return {
		bottles: entries.map((entry) => entry.bottle),
		overview: {
			tastings: tastings.length,
			bottles: entries.length,
			distilleries: [...distilleryCounts.keys()].filter((key) => !PLACEHOLDER_DISTILLERIES.has(key))
				.length,
			countries: countries(entries),
			withoutCountry,
			meanAbv: mean(abvs),
			medianAbv: median(abvs),
			meanAge: mean(ages),
			nas: share(entries.length - aged.length, entries.length),
			totalAge: sum(ages),
			strongest: record(entries, (entry) => entry.input.abv),
			oldest: record(aged, (entry) => entry.input.age!)
		},
		alcohol: {
			pureMl,
			pureGrams: pureMl * ETHANOL_DENSITY,
			beers: pureMl / BEER_PURE_ALCOHOL_ML,
			liquidMl,
			whiskyBottles: liquidMl / WHISKY_BOTTLE_ML,
			hardest:
				entries.length > 0
					? {
							tastingDate: tastings[hardestIndex].tastingDate,
							pureMl: pureMlPerTasting[hardestIndex]
						}
					: null
		},
		people: people(entries, distilleryCounts),
		distilleries: distilleries(entries, tastings),
		timeline: timeline(entries, tastings)
	};
}
