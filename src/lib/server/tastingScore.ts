import {
	formatBottleName,
	normalizeScoreFactors,
	SCORE_FACTORS_BY_WEIGHT,
	SCORE_WEIGHTS,
	smokeGroup,
	SMOKE_GROUPS_ENABLED,
	type ScoreBreakdown,
	type ScoreInput,
	type TastingBottle
} from '$lib/tasting';

// The tunables (weights, ABV range, smoke groups), the normalization and the
// smoke grouping live in $lib/tasting.ts, not here: the TastingScoreExplainer
// tile, the TastingScoreChart and the bottle form render the same numbers for
// participants and can't import a $lib/server module.

export type BottleScore = { score: number; breakdown: ScoreBreakdown };

function roundOne(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * score = 100 * (0.4*S + 0.3*C + 0.1*A + 0.2*W), rounded to one decimal place.
 * Rounding happens before any sorting – otherwise float noise such as
 * 52.00000000000001 would defeat the tie-breakers.
 */
export function scoreBottle(bottle: ScoreInput): BottleScore {
	const normalized = normalizeScoreFactors(bottle);
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

/** First factor (heaviest weight first) on which the bottles differ: the lower value first. */
function compareFactors(a: ScoreInput, b: ScoreInput): number {
	for (const factor of SCORE_FACTORS_BY_WEIGHT) {
		const diff = a[factor] - b[factor];
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Bottles in pouring order (light → heavy → smoky), each with its score:
 * smoke group, then score, then the tie-breakers – the raw factors by weight
 * (smoke, cask, value, abv with the current weights) and the display name.
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
				compareFactors(a, b) ||
				formatBottleName(a).localeCompare(formatBottleName(b), 'de')
		);
}
