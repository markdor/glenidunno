import { describe, expect, it } from 'vitest';
import {
	clampView,
	COUNTRY_LEVELS,
	countryBadgeSize,
	countryView,
	easeInOutCubic,
	interpolateView,
	isBoxOnScreen,
	levelLabels,
	mapLevel,
	panBy,
	REGION_LEVELS,
	regionOpacity,
	resolveBadges,
	scotlandFraction,
	scotlandView,
	toScreen,
	wheelZoomFactor,
	worldScale,
	worldView,
	zoomAt,
	zoomLimits,
	type MapBox,
	type WorldMapGeometry
} from './worldMap';

// A 2000 × 1000 world with Scotland's mainland 40 units high around (900, 200).
const GEOMETRY = {
	width: 2000,
	height: 1000,
	scotlandMainland: [880, 180, 920, 220] as MapBox
} as WorldMapGeometry;
const SIZE = { width: 400, height: 500 };

describe('colour levels', () => {
	it('puts the counts of countries into 1 · 2–3 · 4–19 · 20+', () => {
		expect([0, 1, 2, 3, 4, 19, 20, 87].map((n) => mapLevel(n, COUNTRY_LEVELS))).toEqual([
			0, 1, 2, 2, 3, 3, 4, 4
		]);
		expect(levelLabels(COUNTRY_LEVELS)).toEqual(['1', '2–3', '4–19', '20+']);
	});

	it('puts the counts of regions into 1–3 · 4–7 · 8–14 · 15+', () => {
		expect([0, 1, 3, 4, 7, 8, 14, 15].map((n) => mapLevel(n, REGION_LEVELS))).toEqual([
			0, 1, 1, 2, 2, 3, 3, 4
		]);
		expect(levelLabels(REGION_LEVELS)).toEqual(['1–3', '4–7', '8–14', '15+']);
	});
});

describe('views', () => {
	it('fits the whole world, centred', () => {
		expect(worldScale(SIZE, GEOMETRY)).toBe(0.2);
		const view = worldView(SIZE, GEOMETRY);
		expect(view.k).toBe(0.2);
		expect(toScreen([1000, 500], view)).toEqual([200, 250]);
	});

	it('limits the zoom from 0.8 × the whole world to Scotland 3.2 × the map height', () => {
		const limits = zoomLimits(SIZE, GEOMETRY);
		expect(limits.min).toBeCloseTo(0.16, 10);
		expect(limits.max).toBeCloseTo(40, 10);
		expect(clampView({ k: 0.01, x: 0, y: 0 }, SIZE, GEOMETRY).k).toBeCloseTo(0.16, 10);
		expect(clampView({ k: 100, x: 0, y: 0 }, SIZE, GEOMETRY).k).toBe(40);
	});

	it('keeps the edge of the world at most at the middle of the map', () => {
		// Far to the right: the left edge stops at the middle.
		expect(clampView({ k: 1, x: 900, y: 0 }, SIZE, GEOMETRY)).toEqual({ k: 1, x: 200, y: 0 });
		// Far to the left and up: the right and bottom edges stop at the middle.
		expect(clampView({ k: 1, x: -5000, y: -5000 }, SIZE, GEOMETRY)).toEqual({
			k: 1,
			x: 200 - 2000,
			y: 250 - 1000
		});
	});

	it('shows Scotland in the middle at the given share of the map height', () => {
		const view = scotlandView(0.32, SIZE, GEOMETRY);
		expect(scotlandFraction(view, SIZE, GEOMETRY)).toBeCloseTo(0.32, 10);
		const [x, y] = toScreen([900, 200], view);
		expect(x).toBeCloseTo(200, 10);
		expect(y).toBeCloseTo(250, 10);
	});

	it('flies to a country box at 42 % of the tighter side, never closer than the start view', () => {
		const wide: MapBox = [0, 400, 1000, 500];
		const view = countryView(wide, SIZE, GEOMETRY);
		// The width is tighter: 0.42 × 400 px / 1000 units.
		expect(view.k).toBeCloseTo(0.168, 10);
		const tiny: MapBox = [1500, 600, 1502, 602];
		expect(countryView(tiny, SIZE, GEOMETRY).k).toBeCloseTo(
			scotlandView(0.32, SIZE, GEOMETRY).k,
			10
		);
	});

	it('zooms around a screen point, which stays where it is', () => {
		const view = scotlandView(0.32, SIZE, GEOMETRY);
		const point: [number, number] = [120, 300];
		const before = [(point[0] - view.x) / view.k, (point[1] - view.y) / view.k] as const;
		const zoomed = zoomAt(view, 2, point, SIZE, GEOMETRY);
		expect(zoomed.k).toBeCloseTo(view.k * 2, 10);
		const [x, y] = toScreen([before[0], before[1]], zoomed);
		expect(x).toBeCloseTo(point[0], 10);
		expect(y).toBeCloseTo(point[1], 10);
		// Within the limits only.
		expect(zoomAt(view, 1000, point, SIZE, GEOMETRY).k).toBe(40);
	});

	it('pans within the limits', () => {
		const view = scotlandView(0.32, SIZE, GEOMETRY);
		expect(panBy(view, 10, -5, SIZE, GEOMETRY)).toEqual({
			k: view.k,
			x: view.x + 10,
			y: view.y - 5
		});
		expect(panBy(view, 1e6, 0, SIZE, GEOMETRY).x).toBe(200);
	});

	it('interpolates a flight: zoom geometrically, the middle linearly', () => {
		const from = worldView(SIZE, GEOMETRY);
		const to = scotlandView(0.8, SIZE, GEOMETRY);
		expect(interpolateView(from, to, 0, SIZE)).toEqual(from);
		const end = interpolateView(from, to, 1, SIZE);
		expect(end.k).toBeCloseTo(to.k, 10);
		expect(end.x).toBeCloseTo(to.x, 10);
		const half = interpolateView(from, to, 0.5, SIZE);
		expect(half.k).toBeCloseTo(Math.sqrt(from.k * to.k), 10);
		const [x, y] = toScreen([950, 350], half);
		expect(x).toBeCloseTo(200, 10);
		expect(y).toBeCloseTo(250, 10);
	});

	it('eases in and out', () => {
		expect([0, 0.5, 1].map(easeInOutCubic)).toEqual([0, 0.5, 1]);
		expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
		expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
	});

	it('tells whether a box is on the map', () => {
		const view = { k: 1, x: 0, y: 0 };
		expect(isBoxOnScreen([10, 10, 20, 20], view, SIZE)).toBe(true);
		expect(isBoxOnScreen([390, 490, 500, 600], view, SIZE)).toBe(true);
		expect(isBoxOnScreen([401, 10, 500, 20], view, SIZE)).toBe(false);
		expect(isBoxOnScreen([-50, 10, -1, 20], view, SIZE)).toBe(false);
		expect(isBoxOnScreen([10, 501, 20, 600], view, SIZE)).toBe(false);
	});
});

describe('wheelZoomFactor', () => {
	it('zooms by exp(−deltaY · 0.0022), lines and pages converted to pixels', () => {
		expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(
			Math.exp(0.22),
			10
		);
		expect(wheelZoomFactor({ deltaY: 3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(
			Math.exp(-99 * 0.0022),
			10
		);
		expect(wheelZoomFactor({ deltaY: 1, deltaMode: 2, ctrlKey: false })).toBeCloseTo(
			Math.exp(-400 * 0.0022),
			10
		);
	});

	it('takes bigger steps for a trackpad pinch', () => {
		expect(wheelZoomFactor({ deltaY: 10, deltaMode: 0, ctrlKey: true })).toBeCloseTo(
			Math.exp(-0.1),
			10
		);
	});
});

describe('regionOpacity', () => {
	it('fades the regions in between 44 % and 56 % of the map height', () => {
		expect(regionOpacity(0.3)).toBe(0);
		expect(regionOpacity(0.44)).toBe(0);
		expect(regionOpacity(0.5)).toBeCloseTo(0.5, 10);
		expect(regionOpacity(0.56)).toBeCloseTo(1, 10);
		expect(regionOpacity(0.9)).toBe(1);
	});
});

describe('badges', () => {
	it('estimates the size of a badge, bigger for Scotland', () => {
		expect(countryBadgeSize('12', false)).toEqual({ width: 47, height: 28 });
		expect(countryBadgeSize('12', true)).toEqual({ width: 51, height: 36 });
	});

	it('keeps the biggest count where badges overlap, the others become dots', () => {
		const badge = (id: string, count: number, x: number, y = 100) => ({
			id,
			count,
			x,
			y,
			width: 40,
			height: 28
		});
		const full = resolveBadges([
			badge('SE', 3, 100),
			badge('GB-SCT', 87, 120),
			badge('DK', 1, 130),
			badge('JP', 1, 400),
			// Close in x, but far enough apart in y.
			badge('DE', 2, 120, 140)
		]);
		expect([...full].sort()).toEqual(['DE', 'GB-SCT', 'JP']);
	});

	it('breaks ties by id, so the result does not depend on the order', () => {
		const a = { id: 'A', count: 1, x: 0, y: 0, width: 40, height: 28 };
		const b = { ...a, id: 'B', x: 10 };
		expect([...resolveBadges([b, a])]).toEqual(['A']);
	});
});
