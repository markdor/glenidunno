import { formatBottleName, type ScoreBreakdown, type TastingBottle } from '$lib/tasting';
import { TASTING_SCALE } from '$lib/validation';

// Starting values, to be revisited after the first tasting with real bottles.
// All tunables live here so the weights can be adjusted in one place.

/** Weights of the normalized factors. They sum to 1, so the score spans 0–100. */
export const SCORE_WEIGHTS = { smoke: 0.4, cask: 0.3, abv: 0.2, value: 0.1 } as const;

/** ABV at or below the floor counts as 0, at or above floor + span as 1. */
export const ABV_FLOOR = 40;
export const ABV_SPAN = 20;

/**
 * Smoke groups are poured in ascending order before the score is compared:
 * group 1 = smoke 0–1, group 2 = 2–3, group 3 = 4–5 (upper bounds below).
 */
export const SMOKE_GROUP_UPPER_BOUNDS = [1, 3, 5] as const;

/** With `false` only the score (and the tie-breakers) decide the order. */
export const SMOKE_GROUPS_ENABLED = true;

export type ScoreInput = Pick<TastingBottle, 'smoke' | 'cask' | 'abv' | 'value'>;

export type BottleScore = { score: number; breakdown: ScoreBreakdown };

function roundOne(value: number): number {
	return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function smokeGroup(smoke: number): number {
	return SMOKE_GROUP_UPPER_BOUNDS.findIndex((upper) => smoke <= upper) + 1;
}

/**
 * score = 100 * (0.4*S + 0.3*C + 0.2*A + 0.1*W), rounded to one decimal place.
 * Rounding happens before any sorting – otherwise float noise such as
 * 52.00000000000001 would defeat the tie-breakers.
 */
export function scoreBottle(bottle: ScoreInput): BottleScore {
	const normalized = {
		smoke: bottle.smoke / TASTING_SCALE.max,
		cask: bottle.cask / TASTING_SCALE.max,
		abv: clamp((bottle.abv - ABV_FLOOR) / ABV_SPAN, 0, 1),
		value: bottle.value / TASTING_SCALE.max
	};
	const points = {
		smoke: 100 * SCORE_WEIGHTS.smoke * normalized.smoke,
		cask: 100 * SCORE_WEIGHTS.cask * normalized.cask,
		abv: 100 * SCORE_WEIGHTS.abv * normalized.abv,
		value: 100 * SCORE_WEIGHTS.value * normalized.value
	};
	return {
		score: roundOne(points.smoke + points.cask + points.abv + points.value),
		breakdown: {
			smoke: roundOne(points.smoke),
			cask: roundOne(points.cask),
			abv: roundOne(points.abv),
			value: roundOne(points.value)
		}
	};
}

type SortableBottle = ScoreInput &
	Pick<TastingBottle, 'distillery' | 'age' | 'bottling' | 'bottler'>;

/**
 * Bottles in pouring order (light → heavy → smoky), each with its score:
 * smoke group, then score, then the tie-breakers smoke, cask, abv and the
 * display name.
 */
export function sortForPouring<T extends SortableBottle>(
	bottles: readonly T[],
	smokeGroups: boolean = SMOKE_GROUPS_ENABLED
): Array<T & BottleScore> {
	return bottles
		.map((bottle) => ({ ...bottle, ...scoreBottle(bottle) }))
		.sort(
			(a, b) =>
				(smokeGroups ? smokeGroup(a.smoke) - smokeGroup(b.smoke) : 0) ||
				a.score - b.score ||
				a.smoke - b.smoke ||
				a.cask - b.cask ||
				a.abv - b.abv ||
				formatBottleName(a).localeCompare(formatBottleName(b), 'de')
		);
}
