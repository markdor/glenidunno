import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES, countryName } from './countries';
import { SCOTTISH_REGIONS } from './validation';
import type { WorldMapGeometry } from './worldMap';

// The committed output of scripts/build-map-geometry.ts (npm run map:build).
const raw = readFileSync(new URL('./assets/world-map.json', import.meta.url));
const geometry = JSON.parse(raw.toString('utf-8')) as WorldMapGeometry;

describe('world map geometry asset', () => {
	it('stays within its budget, gzip-compressed as served', () => {
		expect(gzipSync(raw).length).toBeLessThanOrEqual(500_000);
	});

	it('has the four parts of the United Kingdom instead of the United Kingdom', () => {
		for (const code of ['GB-SCT', 'GB-ENG', 'GB-WLS', 'GB-NIR']) {
			expect(geometry.countries[code]?.path, code).toMatch(/^M/);
		}
		expect(geometry.countries.GB).toBeUndefined();
	});

	it('has a few sample countries', () => {
		for (const code of ['IE', 'SE', 'DE', 'TW', 'JP', 'NZ', 'US', 'XK']) {
			expect(geometry.countries[code]?.path, code).toMatch(/^M/);
		}
	});

	it('has a name for every code, and every named country is on the map', () => {
		const codes = Object.keys(geometry.countries);
		for (const code of codes) expect(countryName(code), code).not.toBeNull();
		expect(codes.sort()).toEqual(Object.keys(COUNTRY_NAMES).sort());
	});

	it('has the six whisky regions, keyed like SCOTTISH_REGIONS', () => {
		expect(Object.keys(geometry.regions).sort()).toEqual([...SCOTTISH_REGIONS].sort());
		for (const region of SCOTTISH_REGIONS) {
			expect(geometry.regions[region].path, region).toMatch(/^M/);
		}
		// Islay, Campbeltown and Inseln sit at sea, the others on the land.
		expect(geometry.regions.Islay.label).not.toBeNull();
		expect(geometry.regions.Highlands.label).toBeNull();
	});

	it('places Scotland and its mainland box within the map, in the north-west of Europe', () => {
		const [x0, y0, x1, y1] = geometry.scotlandMainland;
		expect(0 < x0 && x0 < x1 && x1 < geometry.width).toBe(true);
		expect(0 < y0 && y0 < y1 && y1 < geometry.height / 2).toBe(true);
		const [ax, ay] = geometry.countries['GB-SCT'].anchor;
		expect(x0 < ax && ax < x1 && y0 < ay && ay < y1).toBe(true);
	});
});
