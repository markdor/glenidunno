// Whisky tasting domain: phase boundaries, shared types and display helpers.
// Like validation.ts this module must stay free of server-only imports – the
// participant page and the admin pages render dates and bottle names in the
// browser as well.

import {
	TASTING_SCALE,
	type DistilleryValueState,
	type DistilleryVariantKind,
	type ScottishRegion
} from '$lib/validation';

/**
 * Time zone all tasting phases are computed in. The container runs in UTC
 * (no TZ is set), so the server converts `now` to Berlin local time instead of
 * relying on the process time zone.
 */
export const TASTING_TIME_ZONE = 'Europe/Berlin';

/** Local hour on the tasting day from which only the pouring order is shown. */
export const TASTING_ORDER_HOUR = 18;

/** Local hour on the day after the tasting from which everything is revealed. */
export const TASTING_REVEAL_HOUR = 9;

/**
 * Local hour on the tasting day from which a tasting counts as released: its
 * distilleries may be researched (src/lib/server/distilleryResearchJob.ts).
 * By then the entry is long closed and the bottles are on the table.
 */
export const TASTING_RELEASE_HOUR = 21;

/**
 * - `entry`: participants enter their bottles, nobody sees anyone else's
 * - `order`: from 18:00 on the tasting day, only the pouring order of the aliases
 * - `revealed`: from 9:00 on the following day, everything
 */
export type TastingPhase = 'entry' | 'order' | 'revealed';

/**
 * Admin overrides of the clock rules (the "18-Uhr-" and "9-Uhr-Button"): when
 * the pouring order was opened resp. the tasting revealed ahead of time, `null`
 * if the button wasn't pressed. They only ever move the phase forward.
 */
export type ManualPhaseChanges = { orderOpenedAt: Date | null; revealedAt: Date | null };

export const TASTING_PHASE_LABEL: Record<TastingPhase, string> = {
	entry: 'Eingabe',
	order: 'Reihenfolge',
	revealed: 'Aufgelöst'
};

/** A bottle as entered by its participant. Empty optional fields are `null`. */
export type TastingBottle = {
	alias: string;
	distillery: string;
	/** Independent bottler; `null` means original bottling. */
	bottler: string | null;
	bottling: string | null;
	/** Age statement in years; `null` means NAS. */
	age: number | null;
	whiskybaseUrl: string | null;
	smoke: number;
	cask: number;
	abv: number;
	value: number;
};

// View types of the phase-dependent projection (src/lib/server/tastings.ts),
// shared with the components that render them.

/**
 * Entry progress of a participant or a whole tasting. A participant's target
 * is max(TASTING_BOTTLE_SLOTS.base, own bottles), a tasting's the sum of its
 * participants' targets.
 */
export type Progress = { entered: number; total: number };

/**
 * The start page's hero "Nächstes Tasting": the user's own next tasting that
 * isn't revealed yet. Management data plus the slug for the link – no content,
 * not even the user's own bottles. `progress` counts the user's own bottles only.
 */
export type DashboardTasting = {
	slug: string;
	name: string;
	motto: string | null;
	tastingDate: string;
	phase: Exclude<TastingPhase, 'revealed'>;
	isToday: boolean;
	progress: Progress;
};

/**
 * The start page's "Letztes Tasting": the user's own last revealed tasting.
 * Title, motto and date only – the reveal itself stays on the participant page.
 */
export type DashboardLastTasting = Pick<
	DashboardTasting,
	'slug' | 'name' | 'motto' | 'tastingDate'
>;

/**
 * Extensions the presentation viewer can show: PDFs as they are, the others
 * converted to PDF by LibreOffice (Gotenberg). Every other file, also one
 * without an extension, can only be downloaded.
 */
export const VIEWABLE_PRESENTATION_EXTENSIONS: ReadonlySet<string> = new Set([
	'pdf',
	'pptx',
	'ppt',
	'odp',
	'docx',
	'doc',
	'odt'
]);

/** Whether the viewer can show a stored presentation, judged by its file's extension. */
export function isViewablePresentation(file: string): boolean {
	const dot = file.lastIndexOf('.');
	return dot > 0 && VIEWABLE_PRESENTATION_EXTENSIONS.has(file.slice(dot + 1).toLowerCase());
}

/**
 * Link to an uploaded presentation, from the `order` phase on (the slides are
 * shown during the tasting): the bottle id addresses the download route and,
 * if `viewable`, the viewer.
 */
export type PresentationLink = { bottleId: string; viewable: boolean };

/**
 * Position in the pouring order with the total score and the presentation
 * link – everything the `order` phase may show. Neither the factors nor the
 * score breakdown, nor the presentation's file name.
 */
export type OrderEntry = {
	position: number;
	alias: string;
	score: number;
	presentation: PresentationLink | null;
};

/**
 * A presentation link plus the original file name. The name counts as
 * content (it may reveal the whisky), so it only leaves the server with the
 * reveal.
 */
export type PresentationRef = PresentationLink & { name: string };

/** A bottle after the reveal: all fields plus bringer, score and presentation. */
export type RevealedBottle = TastingBottle & {
	position: number;
	broughtBy: string;
	score: number;
	presentation: PresentationRef | null;
};

/**
 * A bottle after the reveal of a tasting with archived bottles. Those come
 * from the tasting history with the ABV only: without smoke, cask and value
 * there is neither a score nor a position. The bottle id (also part of the
 * presentation link) keys the list instead.
 */
export type ArchivedRevealedBottle = Omit<TastingBottle, 'smoke' | 'cask' | 'value'> & {
	id: string;
	broughtBy: string;
	presentation: PresentationRef | null;
};

/**
 * The reveal: the bottles in pouring order – or, once a tasting has an
 * archived bottle, all of them without factors, by bringer and slot.
 */
export type Reveal =
	| { archived: false; bottles: RevealedBottle[] }
	| { archived: true; bottles: ArchivedRevealedBottle[] };

/** Points each factor contributes to the score (they add up to it). */
export type ScoreBreakdown = { smoke: number; cask: number; abv: number; value: number };

// ── Scoring ──────────────────────────────────────────────────────────────
// Starting values, to be revisited after the first tasting with real bottles.
// Shared source of truth for the actual computation (tastingScore.ts, server-only)
// and the TastingScoreExplainer tile, which renders these same numbers for
// participants – so it can't import from $lib/server.

/**
 * Weights of the normalized factors. They sum to 1, so the score spans 0–100.
 * Smoke and cask linger on the palate, ABV doesn't (a sip of water resets it),
 * so it weighs least; value moves the highlights to the end of their group.
 */
export const SCORE_WEIGHTS = { smoke: 0.4, cask: 0.3, abv: 0.1, value: 0.2 } as const;

export type ScoreFactor = keyof typeof SCORE_WEIGHTS;

/**
 * The factors, heaviest weight first. One order for both the tie-breakers on
 * identical scores (tastingScore.ts) and the TastingScoreExplainer tile, so
 * the tile always describes what the sorting does.
 */
export const SCORE_FACTORS_BY_WEIGHT = (Object.keys(SCORE_WEIGHTS) as ScoreFactor[]).sort(
	(a, b) => SCORE_WEIGHTS[b] - SCORE_WEIGHTS[a]
);

/** ABV at or below the floor counts as 0, at or above floor + span as 1. */
export const ABV_FLOOR = 40;
export const ABV_SPAN = 25;

/**
 * Above this ABV the normalized factor climbs twice as fast per % vol as
 * below it – strength stops being a mild differentiator and starts
 * dominating the factor. Both segments still meet at 0 at {@link ABV_FLOOR}
 * and 1 at `ABV_FLOOR + ABV_SPAN`, just with a kink at this point instead of
 * one straight line.
 */
export const ABV_KINK = 50;

const ABV_LOW_SPAN = ABV_KINK - ABV_FLOOR;
const ABV_HIGH_SPAN = ABV_FLOOR + ABV_SPAN - ABV_KINK;

/**
 * % vol per full share below the kink, i.e. the inverse of the slope there.
 * The slope above the kink is fixed at double, so the divisor halves, and the
 * two segments' contributions add up to exactly 1 at the ceiling. Exported
 * together with {@link ABV_KINK_FRACTION} for the TastingScoreExplainer tile,
 * which prints the formula with these numbers.
 */
export const ABV_LOW_DIVISOR = ABV_LOW_SPAN + 2 * ABV_HIGH_SPAN;
export const ABV_HIGH_DIVISOR = ABV_LOW_DIVISOR / 2;
const ABV_LOW_SLOPE = 1 / ABV_LOW_DIVISOR;
/** Normalized ABV share at {@link ABV_KINK}. */
export const ABV_KINK_FRACTION = ABV_LOW_SLOPE * ABV_LOW_SPAN;

/**
 * Smoke groups are poured in ascending order before the score is compared:
 * group 1 = smoke 0, group 2 = 1–3, group 3 = 4–5 (inclusive upper bounds).
 * The first bound sits between "no peat" and "any peat" – the one question
 * every participant rates the same way, and anything peated is poured after
 * everything unpeated. The labels are shown to participants as they are.
 */
export const SMOKE_GROUPS = [
	{ upper: 0, label: 'ungetorft' },
	{ upper: 3, label: 'rauchig' },
	{ upper: 5, label: 'stark rauchig' }
] as const;

/** With `false` only the score (and the tie-breakers) decide the order. */
export const SMOKE_GROUPS_ENABLED = true;

/** 1-based smoke group of a smoke value, see {@link SMOKE_GROUPS}. */
export function smokeGroup(smoke: number): number {
	return SMOKE_GROUPS.findIndex((group) => smoke <= group.upper) + 1;
}

/** Smoke values a 1-based group covers, e.g. "0" or "1–3". */
export function formatSmokeGroupRange(group: number): string {
	const upper = SMOKE_GROUPS[group - 1].upper;
	const lower = group === 1 ? TASTING_SCALE.min : SMOKE_GROUPS[group - 2].upper + 1;
	return lower === upper ? String(lower) : `${lower}–${upper}`;
}

export type ScoreInput = Pick<TastingBottle, 'smoke' | 'cask' | 'abv' | 'value'>;

/** Each factor scaled to 0–1: the fraction that feeds into the weighted score. */
export type NormalizedScoreFactors = { smoke: number; cask: number; abv: number; value: number };

/**
 * ABV normalized to 0–1, in two linear segments that meet at {@link ABV_KINK}:
 * a gentler climb from {@link ABV_FLOOR}, then twice the slope up to
 * `ABV_FLOOR + ABV_SPAN` (clamped outside that range).
 */
function normalizeAbv(abv: number): number {
	if (abv <= ABV_FLOOR) return 0;
	if (abv >= ABV_FLOOR + ABV_SPAN) return 1;
	if (abv <= ABV_KINK) return (abv - ABV_FLOOR) * ABV_LOW_SLOPE;
	return ABV_KINK_FRACTION + (abv - ABV_KINK) * 2 * ABV_LOW_SLOPE;
}

/**
 * Normalizes each scoring factor to 0–1: smoke/cask/value as a fraction of the
 * 0–{@link TASTING_SCALE.max} scale, ABV via {@link normalizeAbv}. Shared by
 * the score computation (tastingScore.ts) and the score-development chart,
 * which plots these same fractions per bottle on one common axis.
 */
export function normalizeScoreFactors(bottle: ScoreInput): NormalizedScoreFactors {
	return {
		smoke: bottle.smoke / TASTING_SCALE.max,
		cask: bottle.cask / TASTING_SCALE.max,
		abv: normalizeAbv(bottle.abv),
		value: bottle.value / TASTING_SCALE.max
	};
}

/** Display name from the name fields, e.g. "Caol Ila 12 Jahre Distillers Edition (Signatory)". */
export function formatBottleName(
	bottle: Pick<TastingBottle, 'distillery' | 'age' | 'bottling' | 'bottler'>
): string {
	const parts = [bottle.distillery];
	if (bottle.age !== null) parts.push(`${bottle.age} Jahre`);
	if (bottle.bottling) parts.push(bottle.bottling);
	const name = parts.join(' ');
	return bottle.bottler ? `${name} (${bottle.bottler})` : name;
}

/**
 * The bottling with a brand in front, when the admin moves a brand entered as
 * distillery ("Stoisha") into it: prefix and a space before the bottling, the
 * prefix alone without one, unchanged if the bottling already starts with it
 * (ignoring case). The caller checks the length.
 */
export function applyBrandPrefix(bottling: string | null, prefix: string): string {
	const current = bottling?.trim() ?? '';
	if (!current) return prefix;
	const lower = (text: string) => text.toLocaleLowerCase('de-DE');
	return lower(current).startsWith(lower(prefix)) ? current : `${prefix} ${current}`;
}

/**
 * How a participant appears in every tasting display: the username, marked
 * as "(inaktiv)" once the admin deactivated the user (instead of deleting
 * them, so their bottles stay in the tasting).
 */
export function participantLabel(username: string, deactivatedAt: Date | null): string {
	return deactivatedAt ? `${username} (inaktiv)` : username;
}

/**
 * Formats a calendar date (`YYYY-MM-DD`) as e.g. "Sa., 24.10.2026". Parsed and
 * formatted in UTC so the day never shifts with the viewer's time zone.
 */
export function formatTastingDate(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', {
		timeZone: 'UTC',
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
}

/**
 * Formats an instant in Berlin time, e.g. "Sa., 24.10.2026 um 17:32 Uhr" – the
 * same for every viewer, independent of the device's time zone.
 */
export function formatTastingTimestamp(value: Date): string {
	const date = value.toLocaleDateString('de-DE', {
		timeZone: TASTING_TIME_ZONE,
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
	const time = value.toLocaleTimeString('de-DE', {
		timeZone: TASTING_TIME_ZONE,
		hour: '2-digit',
		minute: '2-digit'
	});
	return `${date} um ${time} Uhr`;
}

/** German decimal with exactly one fraction digit, e.g. 46.3 → "46,3". */
export function formatOneDecimal(value: number): string {
	return value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** German calendar date of a `YYYY-MM-DD` date, e.g. "21.10.2022" – in UTC like formatTastingDate. */
export function formatDate(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', {
		timeZone: 'UTC',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
}

/** Rounded to a whole number with German thousands separators, e.g. 2706.7 → "2.707". */
export function formatInteger(value: number): string {
	return Math.round(value).toLocaleString('de-DE');
}

/** A count with its noun, e.g. "1 Flasche", "2.707 Flaschen". */
export function formatCount(count: number, one: string, other: string): string {
	return `${formatInteger(count)} ${count === 1 ? one : other}`;
}

/** Production capacity of a distillery, e.g. 1234567 → "1.234.567 l A/Jahr" (litres of pure alcohol). */
export function formatCapacity(litres: number): string {
	return `${formatInteger(litres)} l A/Jahr`;
}

const nameList = new Intl.ListFormat('de', { type: 'conjunction' });

/** Names as German prose, e.g. "Anna, Ben und Cem". */
export function formatNameList(names: string[]): string {
	return nameList.format(names);
}

// ── Statistics ───────────────────────────────────────────────────────────
// The statistics page evaluates all revealed tastings. The aggregation runs
// on the server (src/lib/server/statistics.ts); the constants and types live
// here because the page renders and explains them in the browser.

/**
 * Sample per bottle, tasting and person: every participant tastes every
 * bottle of the tasting, the own ones included. The page names it in its hint.
 */
export const SAMPLE_SIZE_ML = 50;

/** Grams per millilitre of pure alcohol. */
export const ETHANOL_DENSITY = 0.789;

/** Pure alcohol in a half-litre beer at 5 % vol. */
export const BEER_PURE_ALCOHOL_ML = 25;

/** Content of a whisky bottle. */
export const WHISKY_BOTTLE_ML = 700;

/** Range of the "Intervall" sliders: the width in %-points resp. years. */
export const HISTOGRAM_STEP = { min: 1, max: 5 } as const;

/**
 * Axes of the interval histograms. `anchor` is a bound at every width, `step`
 * the width on every page load. `scale` is the precision of the values: the
 * intervals are computed in these units (ABV in tenths, ages in years), so
 * floating point can't put 45.9 and 46.0 into the same interval.
 */
export const ABV_HISTOGRAM = { anchor: 46, step: 4, scale: 10 } as const;
export const AGE_HISTOGRAM = { anchor: 3, step: 3, scale: 1 } as const;

export type HistogramAxis = { anchor: number; scale: number };

/** Half-open: `start` belongs to the interval, `end` to the next one. */
export type HistogramInterval = { start: number; end: number; count: number };

/**
 * The values per interval of the given width, from the interval of the lowest
 * to that of the highest value – the empty ones in between included. Values
 * below the anchor fall into the intervals below it, without a special case.
 */
export function histogramIntervals(
	values: number[],
	axis: HistogramAxis,
	width: number
): HistogramInterval[] {
	if (values.length === 0) return [];
	const indexes = values.map((value) =>
		Math.floor((Math.round(value * axis.scale) - axis.anchor * axis.scale) / (width * axis.scale))
	);
	const first = Math.min(...indexes);
	const counts = new Array<number>(Math.max(...indexes) - first + 1).fill(0);
	for (const index of indexes) counts[index - first]++;
	return counts.map((count, i) => ({
		start: axis.anchor + (first + i) * width,
		end: axis.anchor + (first + i + 1) * width,
		count
	}));
}

/**
 * Index of the bound at `value` (0 = start of the first interval) – for the
 * anchor also the index of the interval that starts there. May lie outside
 * the intervals when no value is near the anchor.
 */
export function histogramBoundIndex(value: number, intervals: HistogramInterval[]): number {
	if (intervals.length === 0) return 0;
	const { start, end } = intervals[0];
	return Math.round((value - start) / (end - start));
}

/**
 * Where a value sits on the interval axis, in intervals from the start of the
 * first one: Ø 11.2 years at a width of 1 from 3 on is 8.2, a fifth into the
 * interval of 11 years.
 */
export function histogramPosition(value: number, intervals: HistogramInterval[]): number {
	if (intervals.length === 0) return 0;
	const { start, end } = intervals[0];
	return Math.min(intervals.length, Math.max(0, (value - start) / (end - start)));
}

/** Height of the highest bar; the count sits on top of it. */
export const HISTOGRAM_BAR_PX = 96;

/** Bar height of a count, `max` being the highest count of the chart. */
export function histogramBarHeight(count: number, max: number): number {
	return Math.round((count / Math.max(1, max)) * HISTOGRAM_BAR_PX);
}

/**
 * Room an axis label needs: its estimated text width (11 px, the widest
 * common system font) plus a gap that keeps the labels apart – on a desktop
 * at a width of 1 every other ABV bound.
 */
const LABEL_CHAR_PX = 6.5;
const LABEL_GAP_PX = 16;

/** Room a count needs: digits at 12 px plus a hair of air. */
const COUNT_CHAR_PX = 7;
const COUNT_GAP_PX = 2;
/** Line height of a count plus its distance to the bar. */
const COUNT_LINE_PX = 18;

/**
 * Only every this many labels fits: the smallest step at which the longest
 * label keeps its room. `slotPx` is the distance between two labels.
 */
export function labelStep(labels: string[], slotPx: number): number {
	const longest = Math.max(0, ...labels.map((label) => label.length));
	return Math.max(1, Math.ceil((longest * LABEL_CHAR_PX + LABEL_GAP_PX) / slotPx));
}

/** Whether label `i` is shown at `step`: the anchor's label always is. */
export function isLabeled(i: number, anchor: number, step: number): boolean {
	return (((i - anchor) % step) + step) % step === 0;
}

/**
 * Which counts are shown on top of their bars, `slotPx` being the width of a
 * column. The highest bars keep theirs first; a count that would overlap one
 * already shown – side by side and at about the same height – is dropped. No
 * count for an empty interval.
 */
export function visibleCounts(counts: number[], max: number, slotPx: number): boolean[] {
	const shown: Array<{ center: number; half: number; bottom: number }> = [];
	const visible = counts.map(() => false);
	const order = counts
		.map((count, i) => ({ count, i }))
		.sort((a, b) => b.count - a.count || a.i - b.i);
	for (const { count, i } of order) {
		if (count === 0) break;
		const box = {
			center: (i + 0.5) * slotPx,
			half: (String(count).length * COUNT_CHAR_PX) / 2,
			bottom: histogramBarHeight(count, max)
		};
		const overlaps = shown.some(
			(other) =>
				Math.abs(other.center - box.center) < other.half + box.half + COUNT_GAP_PX &&
				Math.abs(other.bottom - box.bottom) < COUNT_LINE_PX
		);
		if (!overlaps) {
			shown.push(box);
			visible[i] = true;
		}
	}
	return visible;
}

/** A bottle of a revealed tasting as the history's table lists it. */
export type HistoryBottle = {
	/**
	 * Position in the ascending standard order (by tasting, bringer, slot),
	 * from 1: anchor of the table row (`#bottle-<number>`) and the count of the
	 * milestones – the statistics link to the row with it. The bottle id
	 * doesn't do, it only leaves the server for the viewer's own tastings.
	 */
	number: number;
	tastingDate: string;
	/** The tasting's motto heading (never its description), searchable. */
	motto: string | null;
	/** Link to the participant page: only for the viewer's own tastings. */
	slug: string | null;
	alias: string;
	distillery: string;
	bottler: string | null;
	bottling: string | null;
	age: number | null;
	abv: number;
	whiskybaseUrl: string | null;
	/** participantLabel() of the bringer. */
	broughtBy: string;
	/** Like the slug only for the viewer's own tastings – without the file name. */
	presentation: PresentationLink | null;
};

/**
 * A bottle of a revealed tasting as the statistics use it: what records,
 * milestones, the participant comparison and the histograms show – nothing
 * that only the history's table needs.
 */
export type StatisticsBottle = Pick<
	HistoryBottle,
	'number' | 'tastingDate' | 'distillery' | 'bottler' | 'bottling' | 'age' | 'abv' | 'broughtBy'
>;

/**
 * A record (strongest, oldest): the value, the first holder in standard order
 * and how many more bottles share the value.
 */
export type BottleRecord = { value: number; number: number; more: number };

/** A count and its share of the reference amount in whole percent. */
export type Share = { count: number; percent: number };

/**
 * One person in the participant comparison: the bottles they brought.
 * Averages are rounded to one decimal – the precision shown and compared.
 */
export type PersonStatistics = {
	name: string;
	bottles: number;
	meanAbv: number | null;
	/** Bottles with at least CASK_STRENGTH_ABV. */
	caskStrength: Share;
	independent: Share;
	meanAge: number | null;
	nas: Share;
	/** Own bottles from distilleries that occur exactly once in the statistics. */
	uniqueDistilleries: number;
	/** Different countries of the own bottles' distilleries, as far as known. */
	countries: number;
	/** Number of the strongest own bottle. */
	strongest: number;
};

/** Comparison rows whose highest value is highlighted (and partly earns a title). */
export type PersonMetric =
	'meanAbv' | 'caskStrength' | 'independent' | 'meanAge' | 'uniqueDistilleries' | 'countries';

/**
 * The distilleries with the highest resp. lowest known capacity (several only
 * on a tie) and everybody who brought a bottle of them, alphabetically.
 */
export type CapacityRecord = { capacity: number; distilleries: string[]; persons: string[] };

/** ABV from which a bottle counts as "Fassstärken-Niveau". */
export const CASK_STRENGTH_ABV = 50;

export type Statistics = {
	/** In standard order (see HistoryBottle's number). */
	bottles: StatisticsBottle[];
	overview: {
		tastings: number;
		bottles: number;
		/** Without the placeholders "Blend" and "Unbekannt". */
		distilleries: number;
		/** Different countries of these distilleries, as far as known. */
		countries: number;
		/** Distilleries whose country isn't known (yet). */
		withoutCountry: number;
		meanAbv: number | null;
		medianAbv: number | null;
		/** Without NAS. */
		meanAge: number | null;
		nas: Share;
		/** Sum of all age statements. */
		totalAge: number;
		strongest: BottleRecord | null;
		oldest: BottleRecord | null;
	};
	/** Per person who took part in every tasting, in ml unless noted. */
	alcohol: {
		pureMl: number;
		pureGrams: number;
		beers: number;
		liquidMl: number;
		whiskyBottles: number;
		/** The tasting with the most pure alcohol per person. */
		hardest: { tastingDate: string; pureMl: number } | null;
	};
	people: {
		/** Everybody who brought a bottle, alphabetically. */
		persons: PersonStatistics[];
		/** Per row the names with the highest value – none for 0 or no value. */
		best: Record<PersonMetric, string[]>;
		/** Largest and smallest distillery: only with at least two different known capacities. */
		capacity: { largest: CapacityRecord; smallest: CapacityRecord } | null;
	};
	distilleries: {
		/** Places 1–3: the three highest counts, each with all its distilleries. */
		podium: Array<{ place: number; count: number; names: string[] }>;
		/** Distilleries with more than one bottle, most bottles first. */
		repeaters: Array<{ name: string; count: number }>;
		original: number;
		independent: number;
		topBottlers: { names: string[]; count: number } | null;
		/** The same Whiskybase whisky in several tastings. */
		dejaVu: Array<{ name: string; dates: string[] }>;
	};
	timeline: {
		/** Per tasting in date order; `null` without bottles resp. without an age statement. */
		tastings: Array<{ tastingDate: string; meanAbv: number | null; meanAge: number | null }>;
		/** Every year from the first to the last tasting, gaps included. */
		perYear: Array<{ year: number; count: number }>;
		longestBreak: { days: number; from: string; to: string } | null;
		/** Numbers of the milestone bottles: the first and every MILESTONE_STEP-th. */
		milestones: number[];
	};
};

/** Every this many bottles there is a milestone (besides the first bottle). */
export const MILESTONE_STEP = 50;

// ── Distilleries ─────────────────────────────────────────────────────────
// Facts per distillery, researched once by the Claude API and corrected by the
// admin (section "Destillerien" on /admin). Constants and states live in
// $lib/validation, the projection in $lib/server/distilleries.ts.

/** One value of a distillery: `source` only for a researched or imported value. */
export type DistilleryFact<T> = {
	value: T | null;
	state: DistilleryValueState;
	source: string | null;
};

/** A row of the admin's distillery table: only distilleries of revealed tastings. */
export type AdminDistillery = {
	/** nameKey() of the name, identifies the row in the admin's edit. */
	key: string;
	/** First spelling among the bottles of revealed tastings, in standard order. */
	name: string;
	country: DistilleryFact<string>;
	/** Only if the country is Scotland – otherwise there is no region, not even a state. */
	region: DistilleryFact<ScottishRegion> | null;
	capacity: DistilleryFact<number>;
	/** Estimated API costs of all research calls for this distillery. */
	costMicroUsd: number;
	/**
	 * The bottles of revealed tastings with this distillery, only what their
	 * name needs besides the distillery: the preview of a rename with a brand
	 * prefix (formatBottleName) and the number of bottles.
	 */
	bottles: Array<Pick<TastingBottle, 'age' | 'bottling' | 'bottler'>>;
};

/** An open suggestion of the variant search: rename `variantName` to `targetName`. */
export type DistilleryVariantSuggestion = {
	id: number;
	/** nameKey() of the variant, the row of the admin's table to rename. */
	variantKey: string;
	variantName: string;
	targetName: string;
	kind: DistilleryVariantKind;
	/** Only for a brand: what goes to the front of the bottling. */
	prefix: string | null;
	/** Bottles of revealed tastings with the variant. */
	bottles: number;
};
