import { describe, test, expect, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { StatisticsBottle } from '$lib/tasting';
import { SCOTTISH_REGIONS } from '$lib/validation';
import type { MapBox, WorldMapData, WorldMapGeometry } from '$lib/worldMap';
import Page from './+page.svelte';

const user = { id: 'u-anna', username: 'Anna', isAdmin: false };

const square = ([x0, y0, x1, y1]: MapBox) => `M${x0},${y0}H${x1}V${y1}H${x0}Z`;
const SCOTLAND: MapBox = [880, 180, 920, 220];
const TAIWAN: MapBox = [1700, 400, 1710, 410];
const GEOMETRY: WorldMapGeometry = {
	width: 2000,
	height: 1000,
	sphere: square([0, 0, 2000, 1000]),
	graticule: 'M0,500H2000',
	land: '',
	countries: {
		'GB-SCT': { path: square(SCOTLAND), box: SCOTLAND, anchor: [900, 200] },
		TW: { path: square(TAIWAN), box: TAIWAN, anchor: [1705, 405] }
	},
	regions: Object.fromEntries(
		SCOTTISH_REGIONS.map((region) => [
			region,
			{ path: square([890, 190, 900, 200]), anchor: [895, 195], label: null }
		])
	) as WorldMapGeometry['regions'],
	scotlandMainland: SCOTLAND
};

function bottle(number: number, distillery: string): StatisticsBottle {
	return {
		number,
		tastingDate: '2024-09-27',
		distillery,
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		broughtBy: 'Anna'
	};
}

const WORLD_MAP: WorldMapData = {
	countries: [
		{ code: 'GB-SCT', distilleries: 1, bottles: [bottle(2, 'Ardbeg')] },
		{ code: 'TW', distilleries: 1, bottles: [bottle(1, 'Kavalan')] }
	],
	regions: SCOTTISH_REGIONS.map((region) => ({
		region,
		bottles: region === 'Islay' ? 1 : 0,
		distilleries: region === 'Islay' ? [{ name: 'Ardbeg', bottles: 1 }] : []
	})),
	scotlandWithoutRegion: 0,
	withoutCountry: []
};

function stubGeometry() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(GEOMETRY)))
	);
}

const transform = () => page.getByTestId('map-view').element().getAttribute('transform');

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('world map page', () => {
	test('says so while no tasting is revealed, without a map', async () => {
		render(Page, { data: { user, worldMap: null } });
		await expect.element(page.getByRole('heading', { name: 'Weltkarte' })).toBeVisible();
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Startseite' }))
			.toHaveAttribute('href', '/');
		expect(page.getByText('Kartendaten: Natural Earth').elements()).toHaveLength(0);
	});

	test('shows the map and the details, the source of the map data below', async () => {
		stubGeometry();
		render(Page, { data: { user, worldMap: WORLD_MAP } });
		await expect.element(page.getByTestId('map-view')).toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { name: 'Unsere Herkunftsländer' }))
			.toBeVisible();
		await expect.element(page.getByText('Kartendaten: Natural Earth')).toBeVisible();
	});

	test('a country of the list is selected on the map and flown to', async () => {
		stubGeometry();
		render(Page, { data: { user, worldMap: WORLD_MAP } });
		await expect.element(page.getByTestId('map-view')).toBeInTheDocument();
		const start = transform();

		await page.getByRole('button', { name: /^Taiwan/ }).click();
		await expect.element(page.getByRole('heading', { name: 'Taiwan' })).toBeVisible();
		await expect
			.element(page.getByTestId('map-selected'))
			.toHaveAttribute('d', GEOMETRY.countries.TW.path);
		await expect.poll(transform).not.toBe(start);
		await expect
			.element(page.getByRole('link', { name: /Kavalan/ }))
			.toHaveAttribute('href', '/history#bottle-1');
	});

	test('a region chip zooms onto the regions, the way back to Scotland and all countries', async () => {
		stubGeometry();
		render(Page, { data: { user, worldMap: WORLD_MAP } });
		await expect.element(page.getByTestId('map-view')).toBeInTheDocument();

		await page.getByRole('button', { name: /^Schottland 1 Brennerei/ }).click();
		await page.getByRole('button', { name: /^Islay/ }).click();
		await expect.element(page.getByRole('heading', { name: 'Islay' })).toBeVisible();
		await expect
			.poll(() => page.getByTestId('map-regions').element().getAttribute('opacity'))
			.toBe('1');

		// The details' way back, not the map's button of the same name.
		await page
			.getByRole('region', { name: 'Islay' })
			.getByRole('button', { name: 'Schottland' })
			.click();
		await expect.element(page.getByRole('heading', { name: 'Schottland' })).toBeVisible();
		await page.getByRole('button', { name: 'Alle Länder' }).click();
		await expect
			.element(page.getByRole('heading', { name: 'Unsere Herkunftsländer' }))
			.toBeVisible();
		expect(page.getByTestId('map-selected').elements()).toHaveLength(0);
	});

	test('a badge on the map selects its country for the details', async () => {
		stubGeometry();
		render(Page, { data: { user, worldMap: WORLD_MAP } });
		await page.getByRole('button', { name: 'Schottland: 1 Whisky' }).click();
		await expect.element(page.getByRole('heading', { name: 'Schottland' })).toBeVisible();
	});
});
