// Whisky tasting domain: phase boundaries, shared types and display helpers.
// Like validation.ts this module must stay free of server-only imports – the
// participant page and the admin pages render dates and bottle names in the
// browser as well.

import { TASTING_SCALE } from '$lib/validation';

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
 * Link to an uploaded presentation, from the `order` phase on (the slides are
 * shown during the tasting): the bottle id addresses the download route.
 */
export type PresentationLink = { bottleId: string };

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

/**
 * Class bounds of the histograms: each bound starts a class, so five bounds
 * make six classes, the first and the last one open (< 43, 43–45,9, …, ≥ 60).
 */
export const ABV_HISTOGRAM_BOUNDS = [43, 46, 50, 55, 60] as const;
export const AGE_HISTOGRAM_BOUNDS = [6, 10, 15, 20] as const;

/** Index of the histogram class a value falls into, 0 to `bounds.length`. */
export function histogramClass(value: number, bounds: readonly number[]): number {
	return bounds.filter((bound) => value >= bound).length;
}

/**
 * Labels of the histogram classes. `step` is the precision of the values: a
 * class ends one step below the next bound (43–45,9 for ABV, 6–9 for ages).
 */
export function histogramLabels(bounds: readonly number[], step: number): string[] {
	const upper = (bound: number) =>
		step < 1 ? formatOneDecimal(bound - step) : String(bound - step);
	return [
		`< ${bounds[0]}`,
		...bounds.slice(1).map((bound, i) => `${bounds[i]}–${upper(bound)}`),
		`≥ ${bounds[bounds.length - 1]}`
	];
}

/**
 * Where a value sits on a histogram's class axis: the index of its class plus
 * its linear position inside it (0–1). The open classes reach to `min`/`max`,
 * the bounds of the input.
 */
export function histogramPosition(
	value: number,
	bounds: readonly number[],
	range: { min: number; max: number }
): number {
	const index = histogramClass(value, bounds);
	const lower = index === 0 ? range.min : bounds[index - 1];
	const upper = index === bounds.length ? range.max : bounds[index];
	const inside = upper > lower ? (value - lower) / (upper - lower) : 0;
	return index + Math.min(1, Math.max(0, inside));
}

/** A bottle of a revealed tasting as the statistics table lists it. */
export type StatisticsBottle = {
	/**
	 * Position in the ascending standard order (by tasting, bringer, slot),
	 * from 1: anchor of the table row (`#bottle-<number>`) and the count of
	 * the milestones. The bottle id doesn't do – it only leaves the server for
	 * the viewer's own tastings.
	 */
	number: number;
	tastingDate: string;
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
	/** Number of the strongest own bottle. */
	strongest: number;
};

/** Comparison rows whose highest value is highlighted (and partly earns a title). */
export type PersonMetric =
	'meanAbv' | 'caskStrength' | 'independent' | 'meanAge' | 'uniqueDistilleries';

/** ABV from which a bottle counts as "Fassstärken-Niveau". */
export const CASK_STRENGTH_ABV = 55;

export type Statistics = {
	/** Table order: newest tasting first, within one by bringer and slot. */
	bottles: StatisticsBottle[];
	overview: {
		tastings: number;
		bottles: number;
		/** Without the placeholders "Blend" and "Unbekannt". */
		distilleries: number;
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
	/** Bottles per class of ABV_HISTOGRAM_BOUNDS resp. AGE_HISTOGRAM_BOUNDS (without NAS). */
	distributions: { abv: number[]; age: number[] };
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
