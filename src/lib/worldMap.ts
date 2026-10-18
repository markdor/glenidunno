// The world map (/map): types of the geometry asset and of the projection the
// page gets, the colour levels and the viewport math of WorldMap.svelte. Pure
// and client-safe (no server imports, no DOM), so all of it is testable
// without a browser.

import type { StatisticsBottle } from '$lib/tasting';
import type { ScottishRegion } from '$lib/validation';

/** Code of Scotland in src/lib/countries.ts – the only country with regions. */
export const SCOTLAND_CODE = 'GB-SCT';

// ── Geometry ────────────────────────────────────────────────────────────────

/** A box in map units (the projected geometry): left, top, right, bottom. */
export type MapBox = [x0: number, y0: number, x1: number, y1: number];
export type MapPoint = [x: number, y: number];

/**
 * src/lib/assets/world-map.json as scripts/build-map-geometry.ts writes it:
 * SVG paths projected once with Natural Earth 1, `width` × `height` map units.
 */
export type WorldMapGeometry = {
	width: number;
	height: number;
	sphere: string;
	graticule: string;
	/** Land without a country code (e.g. the Siachen Glacier): drawn, but never hovered. */
	land: string;
	/** By the codes of src/lib/countries.ts; box and anchor of the largest polygon. */
	countries: Record<string, { path: string; box: MapBox; anchor: MapPoint }>;
	/** `label` is where the badge sits at sea, with a line to `anchor` on the land. */
	regions: Record<ScottishRegion, { path: string; anchor: MapPoint; label: MapPoint | null }>;
	/** Scotland's mainland without Shetland: the layer threshold. */
	scotlandMainland: MapBox;
};

// ── Projection ──────────────────────────────────────────────────────────────

/** A country with whiskies. */
export type WorldMapCountry = {
	code: string;
	/** Different distilleries, by name key. */
	distilleries: number;
	/** Newest tasting first. */
	bottles: StatisticsBottle[];
};

/** A whisky region of Scotland, also without any distillery yet. */
export type WorldMapRegion = {
	region: ScottishRegion;
	bottles: number;
	/** The distilleries in their first spelling, most bottles first. */
	distilleries: Array<{ name: string; bottles: number }>;
};

/** What the map page gets: counts and the fields of StatisticsBottle, nothing else. */
export type WorldMapData = {
	/** Most bottles first. */
	countries: WorldMapCountry[];
	/** All six, in the order of SCOTTISH_REGIONS. */
	regions: WorldMapRegion[];
	/** Scottish distilleries without a known region: they count for Scotland only. */
	scotlandWithoutRegion: number;
	/** Placeholders, distilleries without a known country, names without a code. Newest first. */
	withoutCountry: StatisticsBottle[];
};

export type WorldMapSelection =
	{ kind: 'country'; code: string } | { kind: 'region'; region: ScottishRegion };

// ── Colour levels ───────────────────────────────────────────────────────────

/** Lower bounds of the four levels: whiskies per country, distilleries per region. */
export const COUNTRY_LEVELS = [1, 2, 4, 20] as const;
export const REGION_LEVELS = [1, 4, 8, 15] as const;

/** 0 without any, else 1–4: the colour token `map-<level>`. */
export type MapLevel = 0 | 1 | 2 | 3 | 4;

export function mapLevel(count: number, levels: readonly number[]): MapLevel {
	return levels.filter((min) => count >= min).length as MapLevel;
}

/**
 * The colour tokens of layout.css per level, as literal classes (Tailwind only
 * generates classes it finds in the source). Level 0 is land without whisky.
 */
export const LEVEL_FILL_CLASSES = [
	'fill-map-land',
	'fill-map-1',
	'fill-map-2',
	'fill-map-3',
	'fill-map-4'
] as const;
export const LEVEL_BG_CLASSES = [
	'bg-map-land',
	'bg-map-1',
	'bg-map-2',
	'bg-map-3',
	'bg-map-4'
] as const;

/** The legend's labels, e.g. "1", "2–3", "4–19", "20+". */
export function levelLabels(levels: readonly number[]): string[] {
	return levels.map((min, i) => {
		const max = i + 1 < levels.length ? levels[i + 1] - 1 : null;
		return max === null ? `${min}+` : max === min ? String(min) : `${min}–${max}`;
	});
}

// ── Viewport ────────────────────────────────────────────────────────────────
// A view maps map units to screen pixels: screen = map · k + (x, y). Pan and
// zoom only change it, the paths stay as they are.

export type View = { k: number; x: number; y: number };
export type Size = { width: number; height: number };

/** Mouse wheel: zoom factor exp(−deltaY · speed) around the pointer. */
export const WHEEL_ZOOM_SPEED = 0.0022;
/** Trackpad pinch (a wheel event with ctrlKey): bigger steps. */
export const PINCH_ZOOM_SPEED = 0.01;
/** Pixels per line resp. page of a wheel event's deltaMode 1 and 2. */
export const WHEEL_LINE_PX = 33;
export const WHEEL_PAGE_PX = 400;
/** Below this much movement a press is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Two clicks or taps within this time and distance are a double click. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;
export const DOUBLE_TAP_ZOOM = 2;
export const BUTTON_ZOOM = 1.8;
export const ZOOM_DURATION_MS = 320;
export const FLIGHT_DURATION_MS = 700;

/** Farthest out: this much of the scale at which the whole world fits. */
export const MIN_ZOOM_OF_WORLD = 0.8;
/** Closest in: Scotland's mainland this many times the map's height. */
export const MAX_SCOTLAND_HEIGHTS = 3.2;

/** Share of the map's height Scotland's mainland fills in the start view. */
export const START_FRACTION = 0.32;
/** … after "Regionen zeigen" and a region chip – at most, see regionsView(). */
export const REGIONS_FRACTION = 0.8;
/** … but only so much that the mainland fits into this share of the map's width … */
export const REGIONS_WIDTH_SHARE = 0.9;
/** … and at least this much, so the regions are fully shown on a narrow phone too. */
export const REGIONS_MIN_FRACTION = 0.6;
/** Share of the map's height a country's box fills after a flight from the list. */
export const COUNTRY_FLIGHT_FRACTION = 0.42;

/** The regions fade in between these shares of Scotland's mainland … */
export const REGION_FADE_START = 0.44;
export const REGION_FADE_RANGE = 0.12;
/** … and take over (clicks, legend) from this opacity on. */
export const REGION_INTERACTIVE_OPACITY = 0.5;

/** A country badge names the country from this width of the country on screen. */
export const BADGE_NAME_MIN_PX = 90;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function boxCenter([x0, y0, x1, y1]: MapBox): MapPoint {
	return [(x0 + x1) / 2, (y0 + y1) / 2];
}

function scotlandHeight(geometry: WorldMapGeometry): number {
	const [, y0, , y1] = geometry.scotlandMainland;
	return y1 - y0;
}

/** The scale at which the whole world fits. */
export function worldScale(size: Size, geometry: WorldMapGeometry): number {
	return Math.min(size.width / geometry.width, size.height / geometry.height);
}

export function zoomLimits(size: Size, geometry: WorldMapGeometry): { min: number; max: number } {
	return {
		min: MIN_ZOOM_OF_WORLD * worldScale(size, geometry),
		max: (MAX_SCOTLAND_HEIGHTS * size.height) / scotlandHeight(geometry)
	};
}

/**
 * Within the zoom limits, and the world's edge at most up to the middle of the
 * map: the world never leaves the picture entirely.
 */
export function clampView(view: View, size: Size, geometry: WorldMapGeometry): View {
	const limits = zoomLimits(size, geometry);
	const k = clamp(view.k, limits.min, limits.max);
	const cx = size.width / 2;
	const cy = size.height / 2;
	return {
		k,
		x: clamp(view.x, cx - geometry.width * k, cx),
		y: clamp(view.y, cy - geometry.height * k, cy)
	};
}

/** The view with this map point in the middle of the map. */
function centeredView(k: number, [px, py]: MapPoint, size: Size): View {
	return { k, x: size.width / 2 - px * k, y: size.height / 2 - py * k };
}

/** The map point in the middle of the map. */
function viewCenter(view: View, size: Size): MapPoint {
	return [(size.width / 2 - view.x) / view.k, (size.height / 2 - view.y) / view.k];
}

/** The whole world, as big as it fits. */
export function worldView(size: Size, geometry: WorldMapGeometry): View {
	return clampView(
		centeredView(worldScale(size, geometry), [geometry.width / 2, geometry.height / 2], size),
		size,
		geometry
	);
}

/** Scotland in the middle, its mainland filling `fraction` of the map's height. */
export function scotlandView(fraction: number, size: Size, geometry: WorldMapGeometry): View {
	const k = (fraction * size.height) / scotlandHeight(geometry);
	return clampView(centeredView(k, boxCenter(geometry.scotlandMainland), size), size, geometry);
}

/**
 * Close enough for the regions: REGIONS_FRACTION of the map's height, unless
 * the mainland would get wider than the map (a phone held upright) – never
 * below REGIONS_MIN_FRACTION, though.
 */
export function regionsView(size: Size, geometry: WorldMapGeometry): View {
	const [x0, , x1] = geometry.scotlandMainland;
	const fitsWidth =
		(((REGIONS_WIDTH_SHARE * size.width) / (x1 - x0)) * scotlandHeight(geometry)) / size.height;
	const fraction = Math.max(REGIONS_MIN_FRACTION, Math.min(REGIONS_FRACTION, fitsWidth));
	return scotlandView(fraction, size, geometry);
}

/**
 * A country's box in the middle, filling COUNTRY_FLIGHT_FRACTION of the map
 * (whichever side is tighter) – but never closer than the start view, so a
 * small country like Israel doesn't come absurdly close.
 */
export function countryView(box: MapBox, size: Size, geometry: WorldMapGeometry): View {
	const [x0, y0, x1, y1] = box;
	const k = Math.min(
		(COUNTRY_FLIGHT_FRACTION * size.height) / Math.max(y1 - y0, 1e-6),
		(COUNTRY_FLIGHT_FRACTION * size.width) / Math.max(x1 - x0, 1e-6),
		scotlandView(START_FRACTION, size, geometry).k
	);
	return clampView(centeredView(k, boxCenter(box), size), size, geometry);
}

/** Zoom by `factor` around a screen point, which stays where it is (unless clamped). */
export function zoomAt(
	view: View,
	factor: number,
	[sx, sy]: MapPoint,
	size: Size,
	geometry: WorldMapGeometry
): View {
	const limits = zoomLimits(size, geometry);
	const k = clamp(view.k * factor, limits.min, limits.max);
	const ratio = k / view.k;
	return clampView(
		{ k, x: sx - (sx - view.x) * ratio, y: sy - (sy - view.y) * ratio },
		size,
		geometry
	);
}

export function panBy(
	view: View,
	dx: number,
	dy: number,
	size: Size,
	geometry: WorldMapGeometry
): View {
	return clampView({ k: view.k, x: view.x + dx, y: view.y + dy }, size, geometry);
}

/**
 * The view at `t` (0–1) of a flight: the zoom interpolated geometrically (an
 * even feel from the world down to Scotland), the map point in the middle
 * linearly.
 */
export function interpolateView(from: View, to: View, t: number, size: Size): View {
	const k = from.k * (to.k / from.k) ** t;
	const [fx, fy] = viewCenter(from, size);
	const [tx, ty] = viewCenter(to, size);
	return centeredView(k, [fx + (tx - fx) * t, fy + (ty - fy) * t], size);
}

export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The zoom factor of a wheel event: a trackpad pinch comes with ctrlKey. */
export function wheelZoomFactor(event: {
	deltaY: number;
	deltaMode: number;
	ctrlKey: boolean;
}): number {
	const px =
		event.deltaY *
		(event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1);
	return Math.exp(-px * (event.ctrlKey ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED));
}

/** Share of the map's height Scotland's mainland fills. */
export function scotlandFraction(view: View, size: Size, geometry: WorldMapGeometry): number {
	return (scotlandHeight(geometry) * view.k) / size.height;
}

/** Opacity of the region layer: it fades in with the zoom, not with time. */
export function regionOpacity(fraction: number): number {
	return clamp((fraction - REGION_FADE_START) / REGION_FADE_RANGE, 0, 1);
}

export function toScreen([px, py]: MapPoint, view: View): MapPoint {
	return [px * view.k + view.x, py * view.k + view.y];
}

/** The point moved onto the map, at least `margin` from its edges (if the map is big enough). */
export function clampToMap([x, y]: MapPoint, size: Size, margin: Size): MapPoint {
	return [
		clamp(x, margin.width, Math.max(margin.width, size.width - margin.width)),
		clamp(y, margin.height, Math.max(margin.height, size.height - margin.height))
	];
}

/** Whether any of the box is on the map. */
export function isBoxOnScreen(box: MapBox, view: View, size: Size): boolean {
	const [x0, y0] = toScreen([box[0], box[1]], view);
	const [x1, y1] = toScreen([box[2], box[3]], view);
	return x1 > 0 && x0 < size.width && y1 > 0 && y0 < size.height;
}

// ── Badges ──────────────────────────────────────────────────────────────────

/** Estimated text widths (like the histogram's labels) and the badge's padding. */
const BADGE_CHAR_PX = 7.5;
const BADGE_LARGE_CHAR_PX = 9.5;
/** Padding, colour dot and the gap after it. */
const BADGE_PADDING_PX = 32;
const BADGE_HEIGHT_PX = 28;
const BADGE_LARGE_HEIGHT_PX = 36;
/** Air between two badges. */
const BADGE_GAP_PX = 2;

/** The size of a country badge: colour dot, optional name, count. */
export function countryBadgeSize(text: string, large: boolean): Size {
	return {
		width: BADGE_PADDING_PX + text.length * (large ? BADGE_LARGE_CHAR_PX : BADGE_CHAR_PX),
		height: large ? BADGE_LARGE_HEIGHT_PX : BADGE_HEIGHT_PX
	};
}

export type BadgeBox = { id: string; count: number; x: number; y: number } & Size;

/**
 * Badges of one size pushed apart downwards, the top one first – the region
 * badges at sea (Islay, Campbeltown) meet on a narrow phone, where they are
 * moved onto the map. Positions are centres, `half` is half a badge.
 */
export function stackApart(points: MapPoint[], half: Size): MapPoint[] {
	const order = points.map((point, i) => ({ point, i })).sort((a, b) => a.point[1] - b.point[1]);
	const placed: MapPoint[] = [];
	const result = [...points];
	for (const { point, i } of order) {
		const x = point[0];
		let y = point[1];
		for (const [px, py] of placed) {
			if (
				Math.abs(px - x) < 2 * half.width + BADGE_GAP_PX &&
				Math.abs(py - y) < 2 * half.height + BADGE_GAP_PX
			) {
				y = py + 2 * half.height + BADGE_GAP_PX;
			}
		}
		placed.push([x, y]);
		result[i] = [x, y];
	}
	return result;
}

/**
 * Which badges keep their full size, centred at (x, y): the biggest count
 * first, a badge that would overlap one already placed shrinks to a dot.
 */
export function resolveBadges(badges: BadgeBox[]): Set<string> {
	const placed: BadgeBox[] = [];
	const order = [...badges].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
	for (const badge of order) {
		const overlaps = placed.some(
			(other) =>
				Math.abs(other.x - badge.x) < (other.width + badge.width) / 2 + BADGE_GAP_PX &&
				Math.abs(other.y - badge.y) < (other.height + badge.height) / 2 + BADGE_GAP_PX
		);
		if (!overlaps) placed.push(badge);
	}
	return new Set(placed.map((badge) => badge.id));
}
