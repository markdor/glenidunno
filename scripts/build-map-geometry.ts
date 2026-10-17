// Generates src/lib/assets/world-map.json, the geometry of the world map (/map):
// the countries of Natural Earth (world-atlas), the United Kingdom split into
// its four parts and Scotland's mainland into the whisky regions, projected
// with Natural Earth 1 to SVG paths. The browser never projects again: pan and
// zoom only change a transform. Runs once, the result is committed like the
// migrations:
//
//   npm run map:build
//
// Loads src/lib/countries.ts and src/lib/validation.ts by Node type stripping
// (with the .ts extension), so they must stay without imports. The lines that
// cut the United Kingdom and Scotland are rough on purpose: everything is
// clipped against the coastline, they only need to be right at sea and inland.
// After changing them, look at the result once.

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
	geoArea,
	geoCentroid,
	geoGraticule,
	geoNaturalEarth1,
	geoPath,
	type GeoPermissibleObjects
} from 'd3-geo';
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import polygonClipping, { type MultiPolygon as ClipMultiPolygon } from 'polygon-clipping';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { COUNTRY_NAMES } from '../src/lib/countries.ts';
import { SCOTTISH_REGIONS, type ScottishRegion } from '../src/lib/validation.ts';
import { ISO_NUMERIC_TO_ALPHA2 } from './isoNumericCodes.ts';

const OUTPUT = fileURLToPath(new URL('../src/lib/assets/world-map.json', import.meta.url));
/** Projected width; the height follows from the projection. */
const WIDTH = 2000;
const GRATICULE_STEP = 15;
/** Decimals of the paths: Europe and the UK are seen up close, the rest from afar. */
const FINE_DIGITS = 2;
const COARSE_DIGITS = 1;
const EUROPE = { lon: [-25, 45], lat: [34, 72] } as const;
/** Budget of the asset, gzip-compressed (as served). */
const MAX_GZIP_BYTES = 500_000;

/** world-atlas ids replaced by their 10m version (the Hebrides need the detail). */
const UNITED_KINGDOM = '826';
const FINE_SOURCES = ['372', '833']; // Ireland, Isle of Man
/** Natural Earth areas without an ISO number: their code, or none (plain land). */
const WITHOUT_NUMBER: Readonly<Record<string, string>> = {
	Kosovo: 'XK',
	Somaliland: 'SO',
	'N. Cyprus': 'CY'
};
const MERGED_CODES: ReadonlySet<string> = new Set(Object.values(WITHOUT_NUMBER));

// Everything within is England (or Wales).
const ENGLAND_CUT: ClipMultiPolygon = [
	[
		[
			[-8, 49.5],
			[2.5, 49.5],
			[2.5, 55.83],
			[-1.95, 55.83],
			[-2.04, 55.81],
			[-2.3, 55.63],
			[-2.2, 55.48],
			[-2.28, 55.35],
			[-2.58, 55.27],
			[-2.86, 55.14],
			[-3.06, 54.985],
			[-3.39, 54.925],
			[-3.6, 54.78],
			[-4.0, 54.6],
			[-4.6, 54.5],
			[-8, 54.4],
			[-8, 49.5]
		]
	]
];
// Everything within is Wales: Dee estuary → Chester/Wrexham → Offa's Dyke →
// Wye estuary → Bristol Channel.
const WALES_CUT: ClipMultiPolygon = [
	[
		[
			[-6, 53.45],
			[-3.25, 53.45],
			[-3.13, 53.33],
			[-2.93, 53.17],
			[-2.86, 53.02],
			[-3.02, 52.93],
			[-3.1, 52.84],
			[-3.03, 52.68],
			[-3.15, 52.56],
			[-3.03, 52.36],
			[-3.12, 52.2],
			[-3.1, 52.07],
			[-2.95, 51.95],
			[-2.68, 51.84],
			[-2.65, 51.64],
			[-2.8, 51.5],
			[-3.4, 51.35],
			[-6, 51.0],
			[-6, 53.45]
		]
	]
];
// Highland line roughly Greenock → Dundee (Deanston, Glenturret and
// Strathearn lie north of it).
const LOWLANDS_CUT: ClipMultiPolygon = [
	[
		[
			[-4.86, 55.962],
			[-4.7, 55.955],
			[-4.5, 56.02],
			[-4.3, 56.12],
			[-4.1, 56.15],
			[-3.85, 56.2],
			[-3.5, 56.32],
			[-3.1, 56.41],
			[-2.85, 56.44],
			[-2.45, 56.46],
			[-1.0, 56.3],
			[-1.0, 55.0],
			[-3.3, 54.7],
			[-4.2, 54.3],
			[-5.6, 54.3],
			[-5.5, 54.95],
			[-5.05, 55.4],
			[-4.95, 55.85],
			[-4.86, 55.962]
		]
	]
];
// Kintyre south of Tarbert.
const CAMPBELTOWN_CUT: ClipMultiPolygon = [
	[
		[
			[-6.2, 55.15],
			[-5.33, 55.15],
			[-5.33, 55.84],
			[-5.42, 55.865],
			[-6.2, 55.865],
			[-6.2, 55.15]
		]
	]
];
// Moray and Strathspey: Forres to Cullen, south to Tomintoul and Kingussie.
const SPEYSIDE_CUT: ClipMultiPolygon = [
	[
		[
			[-3.76, 57.78],
			[-3.76, 57.55],
			[-3.85, 57.38],
			[-4.0, 57.25],
			[-4.12, 57.07],
			[-3.85, 57.0],
			[-3.55, 57.08],
			[-3.25, 57.12],
			[-3.05, 57.25],
			[-2.9, 57.4],
			[-2.75, 57.55],
			[-2.7, 57.78],
			[-3.76, 57.78]
		]
	]
];

// The islands of the UK's MultiPolygon by the centre of their outer ring.
const isNorthernIreland = ([lon, lat]: Position) =>
	// The polygon on the island of Ireland, Rathlin
	(lon < -5.9 && lat < 55.35) ||
	// Copeland Islands (Sanda off Kintyre stays Scottish)
	(lon < -5.3 && lat > 54.0 && lat < 55.0);
// Holy Island, Farne Islands
const isEnglishCoast = ([lon, lat]: Position) => lon > -2.1 && lat < 55.82;
const isScottish = (c: Position) => c[1] > 55.2 && !isNorthernIreland(c) && !isEnglishCoast(c);
// Jura lies north of it.
const isIslay = ([lon, lat]: Position) => lon > -6.6 && lon < -5.95 && lat > 55.5 && lat < 55.97;

/** Scotland's mainland without Shetland: the layer threshold of the map. */
const SCOTLAND_MAINLAND = { lon: [-7.6, -0.75], lat: [54.63, 58.72] } as const;

/** Badge anchors where the centroid of the largest polygon is a poor spot. */
const COUNTRY_ANCHORS: Readonly<Record<string, Position>> = {
	'GB-SCT': [-4.3, 57.0],
	SE: [15.5, 62.3],
	FI: [26.0, 63.4],
	DK: [9.3, 56.1],
	DE: [10.4, 51.0],
	IS: [-18.6, 64.9],
	IL: [35.0, 31.2],
	IN: [78.8, 22.5],
	BT: [90.4, 27.45],
	TW: [121.0, 23.7],
	JP: [138.3, 36.4],
	NZ: [172.4, -41.6]
};

/** `anchor` on the land; `label` where the badge sits at sea, with a line to the anchor. */
const REGION_BADGES: Readonly<Record<ScottishRegion, { anchor: Position; label?: Position }>> = {
	Highlands: { anchor: [-4.9, 56.95] },
	Speyside: { anchor: [-3.28, 57.42] },
	Lowlands: { anchor: [-3.6, 55.5] },
	Islay: { anchor: [-6.22, 55.77], label: [-7.35, 55.62] },
	Campbeltown: { anchor: [-5.6, 55.45], label: [-5.95, 54.95] },
	Inseln: { anchor: [-6.2, 57.32], label: [-8.05, 57.15] }
};

/** Official areas in km² (rounded); the generated parts must come close. */
const UK_PART_AREAS: Readonly<Record<string, number>> = {
	'GB-SCT': 77_900,
	'GB-ENG': 130_300,
	'GB-WLS': 20_800,
	'GB-NIR': 14_100
};
const AREA_TOLERANCE = 0.02;
const EARTH_RADIUS_KM = 6371.0088;

type Box = [number, number, number, number];
type Point = [number, number];

const require = createRequire(import.meta.url);
type Countries = Topology<{ countries: GeometryCollection<{ name: string }> }>;

function countriesOf(file: string): Array<Feature<Polygon | MultiPolygon, { name: string }>> {
	const topology = require(file) as Countries;
	const collection = feature(topology, topology.objects.countries);
	return collection.features as Array<Feature<Polygon | MultiPolygon, { name: string }>>;
}

function polygonsOf(geometry: Polygon | MultiPolygon): Position[][][] {
	return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function asClip(polygons: Position[][][]): ClipMultiPolygon {
	return polygons as ClipMultiPolygon;
}

/**
 * polygon-clipping returns outer rings counter-clockwise (RFC 7946), d3-geo
 * wants them clockwise – otherwise a polygon fills the whole world but itself.
 * Turned around and checked.
 */
function fromClip(name: string, polygons: ClipMultiPolygon): MultiPolygon {
	const geometry: MultiPolygon = {
		type: 'MultiPolygon',
		coordinates: polygons.map((polygon) => polygon.map((ring) => [...ring].reverse()))
	};
	if (geoArea(geometry) >= 2 * Math.PI) throw new Error(`${name} fills the whole world`);
	return geometry;
}

function union(name: string, polygons: Position[][][]): MultiPolygon {
	return fromClip(name, polygonClipping.union(asClip(polygons)));
}

/** Mean of the ring's points – rough, but enough to tell the islands apart. */
function ringCenter(ring: Position[]): Position {
	const sum = ring.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
	return [sum[0] / ring.length, sum[1] / ring.length];
}

function contains(ring: Position[], [x, y]: Position): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

function largestPolygon(geometry: Polygon | MultiPolygon): Polygon {
	const polygons = polygonsOf(geometry).map((coordinates): Polygon => ({
		type: 'Polygon',
		coordinates
	}));
	return polygons.reduce((a, b) => (geoArea(a) >= geoArea(b) ? a : b));
}

/** The four parts of the United Kingdom and the whisky regions of Scotland. */
function splitUnitedKingdom(geometry: Polygon | MultiPolygon) {
	const polygons = polygonsOf(geometry);
	const greatBritain = largestPolygon(geometry).coordinates;
	const islands: Record<string, Position[][][]> = {
		'GB-SCT': [],
		'GB-ENG': [],
		'GB-WLS': [],
		'GB-NIR': []
	};
	const scottishIslands: Record<'Islay' | 'Inseln', Position[][][]> = { Islay: [], Inseln: [] };
	for (const polygon of polygons) {
		if (polygon === greatBritain) continue;
		const center = ringCenter(polygon[0]);
		if (isNorthernIreland(center)) islands['GB-NIR'].push(polygon);
		else if (isScottish(center)) {
			islands['GB-SCT'].push(polygon);
			scottishIslands[isIslay(center) ? 'Islay' : 'Inseln'].push(polygon);
		} else if (contains(WALES_CUT[0][0], center)) islands['GB-WLS'].push(polygon);
		else islands['GB-ENG'].push(polygon);
	}

	const mainland = asClip([greatBritain]);
	const englandAndWales = polygonClipping.intersection(mainland, ENGLAND_CUT);
	const scotland = polygonClipping.difference(mainland, ENGLAND_CUT);
	const wales = polygonClipping.intersection(englandAndWales, WALES_CUT);
	const england = polygonClipping.difference(englandAndWales, WALES_CUT);

	const parts: Record<string, MultiPolygon> = {
		'GB-SCT': union('GB-SCT', [...scotland, ...islands['GB-SCT']]),
		'GB-ENG': union('GB-ENG', [...england, ...islands['GB-ENG']]),
		'GB-WLS': union('GB-WLS', [...wales, ...islands['GB-WLS']]),
		'GB-NIR': union('GB-NIR', islands['GB-NIR'])
	};
	const regions: Record<ScottishRegion, MultiPolygon> = {
		Islay: union('Islay', scottishIslands.Islay),
		Campbeltown: fromClip('Campbeltown', polygonClipping.intersection(scotland, CAMPBELTOWN_CUT)),
		Inseln: union('Inseln', scottishIslands.Inseln),
		Speyside: fromClip('Speyside', polygonClipping.intersection(scotland, SPEYSIDE_CUT)),
		Highlands: fromClip(
			'Highlands',
			polygonClipping.difference(scotland, LOWLANDS_CUT, CAMPBELTOWN_CUT, SPEYSIDE_CUT)
		),
		Lowlands: fromClip('Lowlands', polygonClipping.intersection(scotland, LOWLANDS_CUT))
	};

	for (const [code, part] of Object.entries(parts)) {
		const km2 = geoArea(part) * EARTH_RADIUS_KM ** 2;
		const official = UK_PART_AREAS[code];
		if (Math.abs(km2 - official) / official > AREA_TOLERANCE) {
			throw new Error(`${code}: ${Math.round(km2)} km², officially about ${official} km²`);
		}
		console.log(`${code}: ${Math.round(km2).toLocaleString('de-DE')} km²`);
	}
	return { parts, regions };
}

/** The countries by code; areas with the same code (Australia twice, Somaliland …) in one. */
function collectCountries() {
	const coarse = countriesOf('world-atlas/countries-50m.json');
	const fine = countriesOf('world-atlas/countries-10m.json');
	const byCode = new Map<string, Position[][][]>();
	const land: Position[][][] = [];
	const add = (code: string, geometry: Polygon | MultiPolygon) =>
		byCode.set(code, [...(byCode.get(code) ?? []), ...polygonsOf(geometry)]);

	for (const country of coarse) {
		const id = country.id === undefined ? undefined : String(country.id);
		if (id === UNITED_KINGDOM || (id && FINE_SOURCES.includes(id))) continue;
		const code = id ? ISO_NUMERIC_TO_ALPHA2[id] : WITHOUT_NUMBER[country.properties.name];
		if (id && !code) throw new Error(`No alpha-2 code for ${id} (${country.properties.name})`);
		if (code) add(code, country.geometry);
		else land.push(...polygonsOf(country.geometry));
	}
	for (const id of FINE_SOURCES) {
		const country = fine.find((c) => String(c.id) === id)!;
		add(ISO_NUMERIC_TO_ALPHA2[id], country.geometry);
	}
	const unitedKingdom = fine.find((c) => String(c.id) === UNITED_KINGDOM)!;
	const { parts, regions } = splitUnitedKingdom(unitedKingdom.geometry);

	const countries = new Map<string, Polygon | MultiPolygon>();
	for (const [code, polygons] of byCode) {
		// Areas without a number share a border with their country (Somalia and
		// Somaliland): dissolved, so no border is drawn within the country.
		countries.set(
			code,
			MERGED_CODES.has(code)
				? union(code, polygons)
				: { type: 'MultiPolygon', coordinates: polygons }
		);
	}
	for (const [code, part] of Object.entries(parts)) countries.set(code, part);
	return { countries, regions, land };
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function build() {
	const { countries, regions, land } = collectCountries();

	const missing = [...countries.keys()].filter((code) => !Object.hasOwn(COUNTRY_NAMES, code));
	if (missing.length > 0) throw new Error(`No name in src/lib/countries.ts: ${missing.join(', ')}`);
	const unused = Object.keys(COUNTRY_NAMES).filter((code) => !countries.has(code));
	if (unused.length > 0) throw new Error(`Not on the map: ${unused.join(', ')}`);

	const sphere: GeoPermissibleObjects = { type: 'Sphere' };
	const projection = geoNaturalEarth1().fitWidth(WIDTH, sphere);
	const path = (digits: number) => geoPath(projection).digits(digits);
	const point = (position: Position): Point => {
		const [x, y] = projection(position as [number, number])!;
		return [round(x), round(y)];
	};
	const box = (object: GeoPermissibleObjects): Box => {
		const [[x0, y0], [x1, y1]] = path(COARSE_DIGITS).bounds(object);
		return [round(x0), round(y0), round(x1), round(y1)];
	};
	const isEurope = ([lon, lat]: Position) =>
		lon >= EUROPE.lon[0] && lon <= EUROPE.lon[1] && lat >= EUROPE.lat[0] && lat <= EUROPE.lat[1];

	const countryEntries = [...countries.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([code, geometry]) => {
			const largest = largestPolygon(geometry);
			const center = geoCentroid(largest);
			const digits = code.startsWith('GB-') || isEurope(center) ? FINE_DIGITS : COARSE_DIGITS;
			return [
				code,
				{
					path: path(digits)(geometry as Geometry)!,
					box: box(largest),
					anchor: point(COUNTRY_ANCHORS[code] ?? center)
				}
			] as const;
		});

	const regionEntries = SCOTTISH_REGIONS.map((region) => {
		const badge = REGION_BADGES[region];
		return [
			region,
			{
				path: path(FINE_DIGITS)(regions[region])!,
				anchor: point(badge.anchor),
				label: badge.label ? point(badge.label) : null
			}
		] as const;
	});

	// The projected box of Scotland's mainland, along its edges (they curve).
	const { lon, lat } = SCOTLAND_MAINLAND;
	const edge = Array.from({ length: 21 }, (_, i) => i / 20);
	const mainland = [
		...edge.map((t) => point([lon[0] + t * (lon[1] - lon[0]), lat[0]])),
		...edge.map((t) => point([lon[0] + t * (lon[1] - lon[0]), lat[1]])),
		...edge.map((t) => point([lon[0], lat[0] + t * (lat[1] - lat[0])])),
		...edge.map((t) => point([lon[1], lat[0] + t * (lat[1] - lat[0])]))
	];
	const xs = mainland.map(([x]) => x);
	const ys = mainland.map(([, y]) => y);

	const [, [, height]] = path(COARSE_DIGITS).bounds(sphere);
	const geometry = {
		width: WIDTH,
		height: Math.ceil(height),
		sphere: path(COARSE_DIGITS)(sphere)!,
		graticule: path(COARSE_DIGITS)(geoGraticule().step([GRATICULE_STEP, GRATICULE_STEP])())!,
		land: path(COARSE_DIGITS)({ type: 'MultiPolygon', coordinates: land })!,
		countries: Object.fromEntries(countryEntries),
		regions: Object.fromEntries(regionEntries),
		scotlandMainland: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
	};

	const json = JSON.stringify(geometry);
	const gzipped = gzipSync(json).length;
	if (gzipped > MAX_GZIP_BYTES) throw new Error(`${gzipped} bytes gzipped, over the budget`);
	writeFileSync(OUTPUT, json);
	console.log(
		`${countryEntries.length} countries, ${Math.round(json.length / 1000)} KB, ` +
			`${Math.round(gzipped / 1000)} KB gzipped → ${OUTPUT}`
	);
}

build();
