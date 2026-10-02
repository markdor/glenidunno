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

/** Entry progress of a participant or a whole tasting. */
export type Progress = { entered: number; total: number };

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
