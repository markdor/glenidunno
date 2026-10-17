import { describe, expect, it } from 'vitest';
import { nameKey } from '$lib/distilleryNames';
import type { ScottishRegion } from '$lib/validation';
import { COUNTRY_LEVELS, mapLevel, REGION_LEVELS } from '$lib/worldMap';
import { DISTILLERY_FACTS, HISTORY_TASTINGS } from '../../../tests/fixtures/historyWorldMap';
import { buildWorldMap, type WorldMapBottleInput } from './worldMap';

function bottle(overrides: Partial<WorldMapBottleInput> = {}): WorldMapBottleInput {
	return {
		number: 1,
		tastingIndex: 0,
		tastingDate: '2024-09-27',
		distillery: 'Ardbeg',
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		username: 'Anna',
		deactivatedAt: null,
		country: 'Schottland',
		region: 'Islay',
		...overrides
	};
}

/** Numbered in the given order, one tasting each unless given. */
function numbered(bottles: Array<Partial<WorldMapBottleInput>>): WorldMapBottleInput[] {
	return bottles.map((b, i) => bottle({ number: i + 1, ...b }));
}

describe('buildWorldMap – countries', () => {
	it('counts every bottle, the same bottling in two tastings twice, and the distinct distilleries', () => {
		const map = buildWorldMap(
			numbered([
				{ distillery: 'Kavalan', country: 'Taiwan', region: null, tastingIndex: 0 },
				{ distillery: 'kavalan ', country: 'Taiwan', region: null, tastingIndex: 1 },
				{ distillery: 'Omar', country: 'taiwan', region: null, tastingIndex: 1 }
			])
		);
		expect(map.countries).toHaveLength(1);
		expect(map.countries[0]).toMatchObject({ code: 'TW', distilleries: 2 });
		expect(map.countries[0].bottles).toHaveLength(3);
	});

	it('counts synonyms as one country', () => {
		const map = buildWorldMap(
			numbered([
				{ distillery: 'Buffalo Trace', country: 'USA', region: null },
				{ distillery: 'Balcones', country: 'Vereinigte Staaten', region: null }
			])
		);
		expect(map.countries.map((c) => [c.code, c.bottles.length])).toEqual([['US', 2]]);
	});

	it('sorts the countries by bottles, then by German name', () => {
		const map = buildWorldMap(
			numbered([
				{ distillery: 'Teerenpeli', country: 'Finnland', region: null },
				{ distillery: 'Stauning', country: 'Dänemark', region: null },
				{ distillery: 'Box', country: 'Schweden', region: null },
				{ distillery: 'Mackmyra', country: 'Schweden', region: null },
				{ distillery: 'Lantenhammer', country: 'Deutschland', region: null }
			])
		);
		expect(map.countries.map((c) => c.code)).toEqual(['SE', 'DK', 'DE', 'FI']);
	});

	it('lists the bottles newest tasting first, within one in standard order', () => {
		const map = buildWorldMap(
			numbered([
				{ distillery: 'Ardbeg', tastingIndex: 0, tastingDate: '2021-05-07' },
				{ distillery: 'Laphroaig', tastingIndex: 1, tastingDate: '2022-02-18' },
				{ distillery: 'Lagavulin', tastingIndex: 1, tastingDate: '2022-02-18' }
			])
		);
		expect(map.countries[0].bottles.map((b) => b.distillery)).toEqual([
			'Laphroaig',
			'Lagavulin',
			'Ardbeg'
		]);
	});

	it('passes only the fields of StatisticsBottle, the bringer marked if deactivated', () => {
		const map = buildWorldMap(
			numbered([
				{
					distillery: 'Kavalan',
					bottler: 'Signatory',
					bottling: 'Solist',
					age: 8,
					abv: 57.8,
					country: 'Taiwan',
					region: null,
					username: 'Ben',
					deactivatedAt: new Date('2025-01-01T00:00:00Z')
				}
			])
		);
		expect(map.countries[0].bottles).toEqual([
			{
				number: 1,
				tastingDate: '2024-09-27',
				distillery: 'Kavalan',
				bottler: 'Signatory',
				bottling: 'Solist',
				age: 8,
				abv: 57.8,
				broughtBy: 'Ben (inaktiv)'
			}
		]);
	});
});

describe('buildWorldMap – regions', () => {
	it('lists all six regions in order, also without any distillery', () => {
		const map = buildWorldMap([]);
		expect(map.regions.map((r) => [r.region, r.bottles, r.distilleries])).toEqual([
			['Islay', 0, []],
			['Campbeltown', 0, []],
			['Inseln', 0, []],
			['Speyside', 0, []],
			['Highlands', 0, []],
			['Lowlands', 0, []]
		]);
		expect(map.countries).toEqual([]);
		expect(map.scotlandWithoutRegion).toBe(0);
	});

	it('counts the distinct distilleries per region in their first spelling, most bottles first', () => {
		const map = buildWorldMap(
			numbered([
				{ distillery: 'Laphroaig' },
				{ distillery: 'Bruichladdich' },
				{ distillery: 'bruichladdich' },
				{ distillery: 'Ardbeg' },
				{ distillery: 'Springbank', region: 'Campbeltown' }
			])
		);
		const islay = map.regions.find((r) => r.region === 'Islay')!;
		expect(islay.bottles).toBe(4);
		expect(islay.distilleries).toEqual([
			{ name: 'Bruichladdich', bottles: 2 },
			{ name: 'Ardbeg', bottles: 1 },
			{ name: 'Laphroaig', bottles: 1 }
		]);
		expect(map.regions.find((r) => r.region === 'Campbeltown')!.distilleries).toHaveLength(1);
		expect(map.countries[0]).toMatchObject({ code: 'GB-SCT', distilleries: 4 });
	});

	it('counts a Scottish distillery without a region for Scotland, but for no region', () => {
		const map = buildWorldMap(
			numbered([
				{ distillery: 'Ardbeg' },
				{ distillery: 'Lochlea', region: null },
				{ distillery: 'lochlea', region: null }
			])
		);
		expect(map.countries[0]).toMatchObject({ code: 'GB-SCT', distilleries: 2 });
		expect(map.countries[0].bottles).toHaveLength(3);
		expect(map.scotlandWithoutRegion).toBe(1);
		expect(map.regions.reduce((sum, r) => sum + r.bottles, 0)).toBe(1);
	});

	it('takes a region only for Scotland', () => {
		const map = buildWorldMap(
			numbered([{ distillery: 'Penderyn', country: 'Wales', region: 'Lowlands' }])
		);
		expect(map.regions.every((r) => r.bottles === 0)).toBe(true);
		expect(map.scotlandWithoutRegion).toBe(0);
	});
});

describe('buildWorldMap – without a country', () => {
	it('collects placeholders, unknown countries and names without a code', () => {
		const map = buildWorldMap(
			numbered([
				// A placeholder is no distillery, not even with a country.
				{ distillery: 'Blend', country: 'Schottland', region: null },
				{ distillery: 'Unbekannt', country: null, region: null },
				{ distillery: 'Mackmyra', country: null, region: null },
				{ distillery: 'Ardbeg', country: 'Schotland', region: null },
				{ distillery: 'Bushmills', country: 'Vereinigtes Königreich', region: null },
				{ distillery: 'Kavalan', country: 'Taiwan', region: null }
			])
		);
		expect(map.withoutCountry.map((b) => b.distillery)).toEqual([
			'Blend',
			'Unbekannt',
			'Mackmyra',
			'Ardbeg',
			'Bushmills'
		]);
		expect(map.countries.map((c) => c.code)).toEqual(['TW']);
	});
});

describe('buildWorldMap – the imported history', () => {
	// The 17 imported tastings with the facts from the issue: its reference values.
	const facts = new Map(DISTILLERY_FACTS.map((f) => [nameKey(f.name), f]));
	let number = 0;
	const inputs = HISTORY_TASTINGS.flatMap((tasting, tastingIndex) =>
		tasting.distilleries.map((distillery) => {
			const fact = facts.get(nameKey(distillery));
			return bottle({
				number: ++number,
				tastingIndex,
				tastingDate: tasting.date,
				distillery,
				country: fact?.country ?? null,
				region: (fact?.region as ScottishRegion | undefined) ?? null
			});
		})
	);
	const map = buildWorldMap(inputs);

	it('counts 107 bottles, 102 of them in twelve countries', () => {
		expect(inputs).toHaveLength(107);
		expect(map.countries.map((c) => [c.code, c.bottles.length, c.distilleries])).toEqual([
			['GB-SCT', 87, 56],
			['SE', 3, 2],
			['DE', 2, 2],
			['TW', 2, 1],
			['BT', 1, 1],
			['DK', 1, 1],
			['FI', 1, 1],
			['IN', 1, 1],
			['IS', 1, 1],
			['IL', 1, 1],
			['JP', 1, 1],
			['NZ', 1, 1]
		]);
		expect(map.countries.map((c) => mapLevel(c.bottles.length, COUNTRY_LEVELS))).toEqual([
			4, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1
		]);
	});

	it('puts the five placeholders under "Ohne Länderangabe"', () => {
		expect(map.withoutCountry.map((b) => b.distillery).sort()).toEqual([
			'Blend',
			'Blend',
			'Unbekannt',
			'Unbekannt',
			'Unbekannt'
		]);
	});

	it('counts the regions, adding up to Scotland', () => {
		const regions = [...map.regions]
			.sort((a, b) => b.distilleries.length - a.distilleries.length)
			.map((r) => [r.region, r.distilleries.length, r.bottles]);
		expect(regions).toEqual([
			['Speyside', 18, 27],
			['Highlands', 17, 23],
			['Islay', 8, 20],
			['Inseln', 7, 9],
			['Lowlands', 4, 5],
			['Campbeltown', 2, 3]
		]);
		expect(map.regions.map((r) => mapLevel(r.distilleries.length, REGION_LEVELS))).toEqual([
			3, 1, 2, 4, 4, 2
		]);
		expect(map.scotlandWithoutRegion).toBe(0);
	});

	it('counts Kavalan twice, it was tasted in 2022 and 2024', () => {
		const taiwan = map.countries.find((c) => c.code === 'TW')!;
		expect(taiwan.bottles.map((b) => b.tastingDate.slice(0, 4))).toEqual(['2024', '2022']);
	});
});
