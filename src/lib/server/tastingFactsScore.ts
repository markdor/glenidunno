import { formatBottleName, type FactsShares, type TastingBottle } from '$lib/tasting';
import type { BottleFacts, Cask, FactsScoreRules, Finish, ScoreRange } from '$lib/tastingFacts';

// The "facts" pouring order. Every function takes the rules as a parameter
// instead of reading the constants of tastingFacts.ts: the order is frozen
// with the rules it was computed by (FACTS_RULES then), and the backtest
// recomputes old tastings with the rules they were poured by.

export type FactsScore = {
	/** The "Wucht", 0–100, rounded to one decimal before any sorting. */
	score: number;
	/** The cask score, 0 to rules.cask.max. */
	caskScore: number;
	shares: FactsShares;
	/** Bounds of the score with an unknown cask, `null` otherwise. */
	range: ScoreRange | null;
};

type ScoredFacts = Pick<TastingBottle, 'abv'> & { facts: BottleFacts };

function roundOne(value: number): number {
	return Math.round(value * 10) / 10;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Base value of a known or other cask: the list's value (less on refill) or the rating. */
function caskBase(
	cask: Exclude<Cask | Finish, { kind: 'none' } | { kind: 'unknown' }>,
	rules: FactsScoreRules
): number {
	if (cask.kind === 'other') return cask.influence;
	const type = rules.cask.types.find((t) => t.key === cask.type);
	if (!type) throw new Error(`cask type ${cask.type} missing in the rules`);
	return cask.refill && type.refill ? Math.max(0, type.base - rules.cask.refillPenalty) : type.base;
}

function durationFactor(months: number | null, rules: FactsScoreRules): number {
	return months === null
		? rules.cask.unknownDurationFactor
		: Math.min(1, months / rules.cask.finishFullMonths);
}

/** What the main maturation adds to the cask score; an unknown one its default. */
function mainPart(cask: Cask, rules: FactsScoreRules): number {
	return cask.kind === 'unknown' ? rules.cask.unknown.cask : caskBase(cask, rules);
}

/** What the finish adds: base × factor × duration factor. */
function finishPart(finish: Finish, rules: FactsScoreRules): number {
	switch (finish.kind) {
		case 'none':
			return 0;
		case 'unknown':
			return rules.cask.unknown.finish * rules.cask.finishFactor * rules.cask.unknownDurationFactor;
		default:
			return (
				caskBase(finish, rules) * rules.cask.finishFactor * durationFactor(finish.months, rules)
			);
	}
}

/** Cask score = min(max, main maturation + finish). */
export function caskScore(facts: BottleFacts, rules: FactsScoreRules): number {
	return Math.min(rules.cask.max, mainPart(facts.cask, rules) + finishPart(facts.finish, rules));
}

/**
 * Bounds of the cask score with an unknown main maturation or finish: the
 * unknown one anywhere between the bounds of rules.cask.unknownRange (a
 * finish at full duration). `null` if neither is unknown.
 */
function caskBounds(facts: BottleFacts, rules: FactsScoreRules): ScoreRange | null {
	const { cask, finish } = facts;
	if (cask.kind !== 'unknown' && finish.kind !== 'unknown') return null;
	const range = rules.cask.unknownRange;
	const main =
		cask.kind === 'unknown'
			? range.cask
			: { min: mainPart(cask, rules), max: mainPart(cask, rules) };
	const fin =
		finish.kind === 'unknown'
			? {
					min: range.finish.min * rules.cask.finishFactor,
					max: range.finish.max * rules.cask.finishFactor
				}
			: { min: finishPart(finish, rules), max: finishPart(finish, rules) };
	return {
		min: Math.min(rules.cask.max, main.min + fin.min),
		max: Math.min(rules.cask.max, main.max + fin.max)
	};
}

/**
 * The factors normalized to 0–1: cask score ÷ max, the ABV linear between
 * floor and ceiling, the price logarithmic between floor and ceiling.
 */
export function factsShares(
	cask: number,
	abv: number,
	priceCents: number | null,
	rules: FactsScoreRules
): FactsShares {
	const price =
		priceCents === null
			? null
			: clamp01(
					Math.log10(priceCents / 100 / rules.price.floor) /
						Math.log10(rules.price.ceiling / rules.price.floor)
				);
	return {
		cask: cask / rules.cask.max,
		abv: clamp01((abv - rules.abv.floor) / (rules.abv.ceiling - rules.abv.floor)),
		price
	};
}

/**
 * Wucht = 100 × Σ weight × share, each factor's points computed on their own.
 * Without a price the other weights are scaled up to sum to 1 again.
 */
function wucht(shares: FactsShares, rules: FactsScoreRules): number {
	const present = rules.factors.filter((f) => shares[f.key] !== null);
	const total = present.reduce((sum, f) => sum + f.weight, 0);
	const points = present.map((f) => (100 * f.weight * (shares[f.key] as number)) / total);
	return roundOne(points.reduce((sum, p) => sum + p, 0));
}

/** Score, shares and – with an unknown cask – the range of a bottle. */
export function scoreFacts(bottle: ScoredFacts, rules: FactsScoreRules): FactsScore {
	const cask = caskScore(bottle.facts, rules);
	const shares = factsShares(cask, bottle.abv, bottle.facts.priceCents, rules);
	const bounds = caskBounds(bottle.facts, rules);
	const scoreAt = (value: number) =>
		wucht(factsShares(value, bottle.abv, bottle.facts.priceCents, rules), rules);
	return {
		score: wucht(shares, rules),
		caskScore: cask,
		shares,
		range: bounds && { min: scoreAt(bounds.min), max: scoreAt(bounds.max) }
	};
}

type SortableFacts = ScoredFacts &
	Pick<TastingBottle, 'distillery' | 'age' | 'bottling' | 'bottler'>;

function compareTieBreakers(a: ScoredFacts, b: ScoredFacts, rules: FactsScoreRules): number {
	for (const key of rules.tieBreakers) {
		if (key === 'abv') {
			if (a.abv !== b.abv) return a.abv - b.abv;
		} else {
			const [pa, pb] = [a.facts.priceCents, b.facts.priceCents];
			if (pa === pb) continue;
			// An unknown price comes last.
			if (pa === null) return 1;
			if (pb === null) return -1;
			return pa - pb;
		}
	}
	return 0;
}

/**
 * Bottles in pouring order, each with its score: peat group, then the
 * "Wucht", then the tie-breakers of the rules and the display name.
 */
export function sortFactsForPouring<T extends SortableFacts>(
	bottles: readonly T[],
	rules: FactsScoreRules
): Array<T & FactsScore> {
	const group = (b: SortableFacts) => rules.peatGroups.findIndex((g) => g.key === b.facts.peat);
	return bottles
		.map((bottle) => ({ ...bottle, ...scoreFacts(bottle, rules) }))
		.sort(
			(a, b) =>
				group(a) - group(b) ||
				a.score - b.score ||
				compareTieBreakers(a, b, rules) ||
				formatBottleName(a).localeCompare(formatBottleName(b), 'de')
		);
}
