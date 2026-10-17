import { describe, test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ResolvedPathname } from '$app/types';
import type { StatisticsBottle } from '$lib/tasting';
import { SCOTTISH_REGIONS } from '$lib/validation';
import type { WorldMapData, WorldMapSelection } from '$lib/worldMap';
import WorldMapDetails from './WorldMapDetails.svelte';

function bottle(overrides: Partial<StatisticsBottle>): StatisticsBottle {
	return {
		number: 1,
		tastingDate: '2024-09-27',
		distillery: 'Ardbeg',
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		broughtBy: 'Anna',
		...overrides
	};
}

const MAP: WorldMapData = {
	countries: [
		{
			code: 'GB-SCT',
			distilleries: 2,
			bottles: [
				bottle({ number: 7, distillery: 'Lagavulin', age: 16, abv: 43, tastingDate: '2024-09-27' }),
				bottle({
					number: 3,
					distillery: 'Ardbeg',
					bottler: 'Signatory',
					bottling: 'Uigeadail',
					abv: 54.2,
					broughtBy: 'Ben',
					tastingDate: '2022-02-18'
				}),
				bottle({ number: 2, distillery: 'Lochlea', tastingDate: '2022-02-18' })
			]
		},
		{ code: 'TW', distilleries: 1, bottles: [bottle({ number: 5, distillery: 'Kavalan' })] }
	],
	regions: SCOTTISH_REGIONS.map((region) => ({
		region,
		bottles: region === 'Islay' ? 2 : 0,
		distilleries:
			region === 'Islay'
				? [
						{ name: 'Ardbeg', bottles: 1 },
						{ name: 'Lagavulin', bottles: 1 }
					]
				: []
	})),
	scotlandWithoutRegion: 1,
	withoutCountry: [bottle({ number: 4, distillery: 'Blend', bottling: 'Turntable Track 2' })]
};

const bottleHref = (number: number) => `/history#bottle-${number}` as ResolvedPathname;

function show(selection: WorldMapSelection | null = null, map: WorldMapData = MAP) {
	const onselect = vi.fn();
	render(WorldMapDetails, { map, selection, onselect, bottleHref });
	return onselect;
}

describe('WorldMapDetails', () => {
	test('lists the countries with level, distilleries and whiskies, and those without a country', async () => {
		const onselect = show();
		await expect
			.element(page.getByRole('heading', { name: 'Unsere Herkunftsländer' }))
			.toBeVisible();
		await expect.element(page.getByText('2 Länder')).toBeVisible();

		const scotland = page.getByRole('button', { name: /^Schottland/ });
		await expect.element(scotland).toHaveTextContent('2 Brennereien · 3 Whiskys');
		expect(scotland.element().querySelector('.bg-map-2')).not.toBeNull();
		await expect
			.element(page.getByRole('button', { name: /^Taiwan/ }))
			.toHaveTextContent('1 Brennerei · 1 Whisky');

		await expect.element(page.getByRole('heading', { name: /Ohne Länderangabe/ })).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: /Blend · Originalabfüllung/ }))
			.toHaveAttribute('href', '/history#bottle-4');

		await page.getByRole('button', { name: /^Taiwan/ }).click();
		// List entries fly there.
		expect(onselect).toHaveBeenCalledWith({ kind: 'country', code: 'TW' }, true);
	});

	test('says nothing about countries or without a country while there are none', async () => {
		show(null, { ...MAP, countries: [], withoutCountry: [] });
		await expect.element(page.getByText('0 Länder')).toBeVisible();
		expect(page.getByRole('list').elements()).toHaveLength(0);
		expect(page.getByText('Ohne Länderangabe').elements()).toHaveLength(0);
	});

	test('shows a country with all its bottles, newest first, linked to the history', async () => {
		const onselect = show({ kind: 'country', code: 'GB-SCT' });
		await expect.element(page.getByRole('heading', { name: 'Schottland' })).toBeVisible();
		await expect.element(page.getByText('3 Whiskys · 2 Brennereien')).toBeVisible();

		const links = page.getByRole('link').elements();
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/history#bottle-7',
			'/history#bottle-3',
			'/history#bottle-2'
		]);
		expect(links[0].textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'27.09.2024 Lagavulin · Originalabfüllung 16 Jahre · 43,0 % mitgebracht von Anna'
		);
		expect(links[1].textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'18.02.2022 Ardbeg · Signatory Uigeadail NAS · 54,2 % mitgebracht von Ben'
		);

		await page.getByRole('button', { name: 'Alle Länder' }).click();
		expect(onselect).toHaveBeenCalledWith(null, false);
	});

	test('offers the regions of Scotland as chips, and those without a region', async () => {
		const onselect = show({ kind: 'country', code: 'GB-SCT' });
		const chips = page.getByRole('listitem').filter({ has: page.getByRole('button') });
		await expect.element(chips.first()).toBeVisible();
		expect(
			SCOTTISH_REGIONS.map(
				(region) =>
					page.getByRole('button', { name: new RegExp(`^${region}`) }).element().textContent
			).map((text) => text?.replace(/\s+/g, ' ').trim())
		).toEqual([
			'Islay 2 Brennereien',
			'Campbeltown 0 Brennereien',
			'Inseln 0 Brennereien',
			'Speyside 0 Brennereien',
			'Highlands 0 Brennereien',
			'Lowlands 0 Brennereien'
		]);
		await expect.element(page.getByText('1 Brennerei ohne Region')).toBeVisible();

		await page.getByRole('button', { name: /^Islay/ }).click();
		// The chip zooms onto the regions.
		expect(onselect).toHaveBeenCalledWith({ kind: 'region', region: 'Islay' }, true);
	});

	test('has no region chips for other countries', async () => {
		show({ kind: 'country', code: 'TW' });
		await expect.element(page.getByRole('heading', { name: 'Taiwan' })).toBeVisible();
		expect(page.getByRole('heading', { name: 'Regionen' }).elements()).toHaveLength(0);
		expect(page.getByText('ohne Region').elements()).toHaveLength(0);
	});

	test('leaves out the hint while every Scottish distillery has a region', async () => {
		show({ kind: 'country', code: 'GB-SCT' }, { ...MAP, scotlandWithoutRegion: 0 });
		await expect.element(page.getByRole('heading', { name: 'Regionen' })).toBeVisible();
		expect(page.getByText('ohne Region').elements()).toHaveLength(0);
	});

	test('shows a region with its distilleries, and leads back to Scotland', async () => {
		const onselect = show({ kind: 'region', region: 'Islay' });
		await expect.element(page.getByRole('heading', { name: 'Islay' })).toBeVisible();
		await expect.element(page.getByText('2 Brennereien · 2 Whiskys')).toBeVisible();
		expect(
			page
				.getByRole('listitem')
				.elements()
				.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())
		).toEqual(['Ardbeg 1 Whisky', 'Lagavulin 1 Whisky']);

		await page.getByRole('button', { name: 'Schottland' }).click();
		expect(onselect).toHaveBeenCalledWith({ kind: 'country', code: 'GB-SCT' }, false);
	});

	test('says so for a region without any distillery yet', async () => {
		show({ kind: 'region', region: 'Lowlands' });
		await expect.element(page.getByText('0 Brennereien · 0 Whiskys')).toBeVisible();
		await expect.element(page.getByText('Noch kein Whisky von hier.')).toBeVisible();
	});

	test('moves the focus to the new heading after a choice', async () => {
		const onselect = vi.fn();
		const { rerender } = render(WorldMapDetails, {
			map: MAP,
			selection: null,
			onselect,
			bottleHref
		});
		onselect.mockImplementation((selection: WorldMapSelection | null) => rerender({ selection }));
		await page.getByRole('button', { name: /^Taiwan/ }).click();
		await expect.element(page.getByRole('heading', { name: 'Taiwan' })).toHaveFocus();
	});

	test('falls back to the list for a selection that is not in the data', async () => {
		show({ kind: 'country', code: 'FR' });
		await expect
			.element(page.getByRole('heading', { name: 'Unsere Herkunftsländer' }))
			.toBeVisible();
	});
});
