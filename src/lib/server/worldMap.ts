// Aggregation of the world map (/map) over all revealed tastings. Pure, without
// database access like statistics.ts: getWorldMap() in tastings.ts decides
// which bottles count and which fields leave the server.

import { countryCode, countryName } from '$lib/countries';
import { groupByName, isPlaceholderDistillery, nameKey } from '$lib/distilleryNames';
import { participantLabel, type StatisticsBottle } from '$lib/tasting';
import { SCOTTISH_REGIONS, type ScottishRegion } from '$lib/validation';
import {
	SCOTLAND_CODE,
	type WorldMapCountry,
	type WorldMapData,
	type WorldMapRegion
} from '$lib/worldMap';

/**
 * A bottle of a revealed tasting, numbered like the statistics (numberBottles),
 * with the known country and region of its distillery (`null` while not known).
 */
export type WorldMapBottleInput = {
	number: number;
	tastingIndex: number;
	tastingDate: string;
	distillery: string;
	bottler: string | null;
	bottling: string | null;
	age: number | null;
	abv: number;
	username: string;
	deactivatedAt: Date | null;
	country: string | null;
	region: ScottishRegion | null;
};

const collator = new Intl.Collator('de');

/** The code the bottle counts for; `null` puts it under "Ohne Länderangabe". */
function codeOf(input: WorldMapBottleInput): string | null {
	if (input.country === null || isPlaceholderDistillery(input.distillery)) return null;
	return countryCode(input.country);
}

/** Newest tasting first, within one in standard order – like the history's table. */
function newestFirst(entries: Entry[]): StatisticsBottle[] {
	return [...entries]
		.sort((a, b) => b.input.tastingIndex - a.input.tastingIndex || a.input.number - b.input.number)
		.map((entry) => entry.bottle);
}

type Entry = { bottle: StatisticsBottle; input: WorldMapBottleInput };

function distinctDistilleries(entries: Entry[]): number {
	return new Set(entries.map((entry) => nameKey(entry.input.distillery))).size;
}

function region(region: ScottishRegion, entries: Entry[]): WorldMapRegion {
	// In standard order, so a distillery is named by its first spelling.
	const names = [...entries]
		.sort((a, b) => a.input.number - b.input.number)
		.map((entry) => entry.input.distillery);
	return {
		region,
		bottles: entries.length,
		distilleries: groupByName(names)
			.map((group) => ({ name: group.name, bottles: group.count }))
			.sort((a, b) => b.bottles - a.bottles || collator.compare(a.name, b.name))
	};
}

/**
 * Countries, regions and the bottles without a country. Every bottle counts,
 * the same bottling in two tastings twice; a region only counts for Scotland,
 * a Scottish distillery without a known region for Scotland but no region.
 */
export function buildWorldMap(bottles: WorldMapBottleInput[]): WorldMapData {
	const entries: Entry[] = bottles.map((input) => ({
		// Picked explicitly, never spread: the input's fields aren't all for the page.
		bottle: {
			number: input.number,
			tastingDate: input.tastingDate,
			distillery: input.distillery,
			bottler: input.bottler,
			bottling: input.bottling,
			age: input.age,
			abv: input.abv,
			broughtBy: participantLabel(input.username, input.deactivatedAt)
		},
		input
	}));

	const byCode = Map.groupBy(entries, (entry) => codeOf(entry.input));
	const withoutCountry = byCode.get(null) ?? [];
	byCode.delete(null);

	const countries: WorldMapCountry[] = [...byCode.entries()]
		.map(([code, own]) => ({
			code: code!,
			distilleries: distinctDistilleries(own),
			bottles: newestFirst(own)
		}))
		.sort(
			(a, b) =>
				b.bottles.length - a.bottles.length ||
				collator.compare(countryName(a.code)!, countryName(b.code)!)
		);

	const scottish = byCode.get(SCOTLAND_CODE) ?? [];
	const byRegion = Map.groupBy(scottish, (entry) => entry.input.region);

	return {
		countries,
		regions: SCOTTISH_REGIONS.map((name) => region(name, byRegion.get(name) ?? [])),
		scotlandWithoutRegion: distinctDistilleries(byRegion.get(null) ?? []),
		withoutCountry: newestFirst(withoutCountry)
	};
}
