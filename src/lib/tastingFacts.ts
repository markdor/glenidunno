// The "facts" pouring order (TASTING_ALGORITHMS): instead of the bringers'
// estimates, what label and shop say – peat, the casks of main maturation and
// finish, the price and the ABV. Types, the cask table, the tunables and the
// rules the explainer tile shows (FACTS_RULES, frozen with each order). The
// computation lives in $lib/server/tastingFactsScore.ts and takes the rules as
// a parameter; like tasting.ts this module stays free of server imports, the
// bottle form shows the cask list in the browser.

import { formatOneDecimal, type TastingBottle } from '$lib/tasting';
import {
	CASK_TYPE_WITHOUT_REFILL,
	TASTING_CASK_INFLUENCE,
	TASTING_CASK_TYPES,
	type CaskType,
	type PeatLevel
} from '$lib/validation';

/**
 * A cask of the main maturation: one of the list (refill only where the
 * list allows it), another one the bringer names and rates, or not known.
 */
export type Cask =
	| { kind: 'known'; type: CaskType; refill: boolean }
	| { kind: 'other'; label: string; influence: number }
	| { kind: 'unknown' };

/** The finish: like a cask plus its duration (`null` = unknown), or none. */
export type Finish =
	| { kind: 'none' }
	| { kind: 'known'; type: CaskType; refill: boolean; months: number | null }
	| { kind: 'other'; label: string; influence: number; months: number | null }
	| { kind: 'unknown' };

export type BottleFacts = {
	peat: PeatLevel;
	cask: Cask;
	finish: Finish;
	/** List or shop price per 0.7 l in cents, `null` = unknown. */
	priceCents: number | null;
};

/** A bottle of a `facts` tasting: the name fields and ABV, the facts instead of the sliders. */
export type FactsBottle = Omit<TastingBottle, 'smoke' | 'cask' | 'value'> & { facts: BottleFacts };

// ── Tunables ──────────────────────────────────────────────────────────────
// Starting values like the taste algorithm's. A change only applies to
// tastings still in entry: the others keep the rules frozen with their order.

/** Weights of the normalized factors, summing to 1: the "Wucht" spans 0–100. */
export const FACTS_WEIGHTS = { cask: 0.5, abv: 0.3, price: 0.2 } as const;
export type FactsFactor = keyof typeof FACTS_WEIGHTS;

/** Upper bound of the cask score; its share is the score ÷ this. */
export const FACTS_CASK_MAX = 10;
/** A refill cask counts its base value minus this (never below 0). */
export const REFILL_PENALTY = 2;
/** A finish counts its base value times this, times the duration factor. */
export const FINISH_FACTOR = 0.5;
/** From this many months on a finish counts in full. */
export const FINISH_FULL_MONTHS = 12;
/** Duration factor of a finish without a duration. */
export const UNKNOWN_DURATION_FACTOR = 0.5;
/** Base value of an unknown main maturation (and of an unknown finish). */
export const UNKNOWN_CASK_BASE = 4;
export const UNKNOWN_FINISH_BASE = 0;
/** ABV share: linear from floor (0) to ceiling (1), in % vol. */
export const FACTS_ABV = { floor: 40, ceiling: 60 } as const;
/** Price share: logarithmic from floor (0) to ceiling (1), in euros. */
export const FACTS_PRICE = { floor: 25, ceiling: 150 } as const;

/** The select's groups, in this order. */
export const CASK_GROUPS = [
	{ key: 'bourbon', label: 'Bourbon' },
	{ key: 'sherry', label: 'Sherry' },
	{ key: 'wine', label: 'Wein' },
	{ key: 'spirits', label: 'Sonstige Spirituosen und Fässer' }
] as const;
type CaskGroup = (typeof CASK_GROUPS)[number]['key'];

/**
 * The select values besides the cask types, shared by the form and the save
 * action's parser: the kinds of Cask and Finish that aren't one of the list.
 */
export const OTHER_CASK = 'other' satisfies Cask['kind'];
export const UNKNOWN_CASK = 'unknown' satisfies Cask['kind'];
export const NO_FINISH = 'none' satisfies Finish['kind'];

/**
 * The cask table: the typical base value of each cask of the list (0–10).
 * Without "Refill" this value counts, with it REFILL_PENALTY less.
 */
export const CASKS: Record<CaskType, { label: string; group: CaskGroup; base: number }> = {
	bourbon: { label: 'Ex-Bourbon', group: 'bourbon', base: 4 },
	sherry_fino: { label: 'Sherry Fino/Manzanilla', group: 'sherry', base: 4 },
	sherry_oloroso: { label: 'Sherry Oloroso/Amontillado', group: 'sherry', base: 7 },
	sherry: { label: 'Sherry (ohne nähere Angabe)', group: 'sherry', base: 7 },
	sherry_px: { label: 'Sherry PX', group: 'sherry', base: 9 },
	red_wine: { label: 'Rotwein', group: 'wine', base: 6 },
	port: { label: 'Port', group: 'wine', base: 6 },
	madeira: { label: 'Madeira', group: 'wine', base: 5 },
	rum: { label: 'Rum', group: 'spirits', base: 5 },
	cognac: { label: 'Cognac', group: 'spirits', base: 5 },
	virgin_oak: { label: 'Virgin Oak', group: 'spirits', base: 7 }
};

/** Whether the bringer can mark the cask as refill. */
export function isRefillable(type: CaskType): boolean {
	return type !== CASK_TYPE_WITHOUT_REFILL;
}

/** Answers of the peat field and the groups of the order, poured in this order. */
export const PEAT_LEVELS: ReadonlyArray<{ key: PeatLevel; answer: string; group: string }> = [
	{ key: 'none', answer: 'nein', group: 'ungetorft' },
	{ key: 'light', answer: 'leicht', group: 'leicht getorft' },
	{ key: 'heavy', answer: 'stark', group: 'stark getorft' }
];

export function peatLevel(key: PeatLevel) {
	return PEAT_LEVELS.find((level) => level.key === key)!;
}

// ── Rules ─────────────────────────────────────────────────────────────────

export type FactsScoreRules = {
	version: 2;
	/** Poured in this order. */
	peatGroups: Array<{ key: PeatLevel; label: string }>;
	/** Heaviest weight first. */
	factors: Array<{ key: FactsFactor; weight: number }>;
	cask: {
		/** The cask score is capped here; its share is the score ÷ max. */
		max: number;
		types: Array<{ key: CaskType; label: string; base: number; refill: boolean }>;
		refillPenalty: number;
		/** Range of the rating of an `other` cask, which replaces the base value. */
		influence: { min: number; max: number };
		/** finish = base × finishFactor × min(1, months ÷ finishFullMonths) */
		finishFactor: number;
		finishFullMonths: number;
		unknownDurationFactor: number;
		/** Base values the order uses for an unknown main maturation resp. finish. */
		unknown: { cask: number; finish: number };
		/**
		 * Base values an unknown cask may have: the bounds of the range shown
		 * with the reveal (a finish at full duration).
		 */
		unknownRange: { cask: { min: number; max: number }; finish: { min: number; max: number } };
	};
	abv: { floor: number; ceiling: number };
	price: { floor: number; ceiling: number };
	/** On an identical score, in this order; the bottle name last. An unknown price comes last. */
	tieBreakers: Array<'abv' | 'price'>;
};

const caskTypes = TASTING_CASK_TYPES.map((key) => ({
	key,
	label: CASKS[key].label,
	base: CASKS[key].base,
	refill: isRefillable(key)
}));
const refilled = caskTypes.map((t) => (t.refill ? Math.max(0, t.base - REFILL_PENALTY) : t.base));
const highestBase = Math.max(...caskTypes.map((t) => t.base));

/** The rules as the code computes a facts order now. */
export const FACTS_RULES: FactsScoreRules = {
	version: 2,
	peatGroups: PEAT_LEVELS.map((level) => ({ key: level.key, label: level.group })),
	factors: (Object.keys(FACTS_WEIGHTS) as FactsFactor[])
		.sort((a, b) => FACTS_WEIGHTS[b] - FACTS_WEIGHTS[a])
		.map((key) => ({ key, weight: FACTS_WEIGHTS[key] })),
	cask: {
		max: FACTS_CASK_MAX,
		types: caskTypes,
		refillPenalty: REFILL_PENALTY,
		influence: { min: TASTING_CASK_INFLUENCE.min, max: TASTING_CASK_INFLUENCE.max },
		finishFactor: FINISH_FACTOR,
		finishFullMonths: FINISH_FULL_MONTHS,
		unknownDurationFactor: UNKNOWN_DURATION_FACTOR,
		unknown: { cask: UNKNOWN_CASK_BASE, finish: UNKNOWN_FINISH_BASE },
		unknownRange: {
			cask: { min: Math.min(...refilled), max: highestBase },
			finish: { min: 0, max: highestBase }
		}
	},
	abv: { floor: FACTS_ABV.floor, ceiling: FACTS_ABV.ceiling },
	price: { floor: FACTS_PRICE.floor, ceiling: FACTS_PRICE.ceiling },
	tieBreakers: ['abv', 'price']
};

// ── Display ───────────────────────────────────────────────────────────────

/** A cask as the reveal names it, e.g. "Sherry PX (Refill)" or "Tequila (Einfluss 4 von 10)". */
export function formatCask(cask: Cask | Exclude<Finish, { kind: 'none' }>): string {
	switch (cask.kind) {
		case 'known':
			return cask.refill ? `${CASKS[cask.type].label} (Refill)` : CASKS[cask.type].label;
		case 'other':
			return `${cask.label} (Einfluss ${cask.influence} von ${TASTING_CASK_INFLUENCE.max})`;
		case 'unknown':
			return 'unbekannt';
	}
}

/** A finish with its duration, e.g. "Sherry PX, 12 Monate", or "keine". */
export function formatFinish(finish: Finish): string {
	if (finish.kind === 'none') return 'keine';
	if (finish.kind === 'unknown') return 'unbekannt';
	const months =
		finish.months === null
			? 'Dauer unbekannt'
			: `${finish.months} ${finish.months === 1 ? 'Monat' : 'Monate'}`;
	return `${formatCask(finish)}, ${months}`;
}

/** A price in cents as euros, e.g. 4990 → "49,90 €"; "unbekannt" for `null`. */
export function formatPrice(cents: number | null): string {
	if (cents === null) return 'unbekannt';
	return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

/** A German number without trailing zeros, e.g. 0.5 → "0,5", 12 → "12". */
export function formatNumber(value: number): string {
	return value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

/** The range of a score, e.g. "13,8–48,8". */
export function formatRange(range: ScoreRange): string {
	return `${formatOneDecimal(range.min)}–${formatOneDecimal(range.max)}`;
}

/** Bounds of the score of a bottle with an unknown cask. */
export type ScoreRange = { min: number; max: number };

/**
 * Positions of the bottles whose order is uncertain: a bottle with a range
 * whose range overlaps the one of its direct neighbor of the same peat group
 * (a bottle without a range counts with its score) – both get the hint.
 * Across a group boundary the range can't change the order.
 */
export function uncertainPositions(
	bottles: ReadonlyArray<{
		position: number;
		peat: PeatLevel;
		score: number;
		range: ScoreRange | null;
	}>
): Set<number> {
	const sorted = [...bottles].sort((a, b) => a.position - b.position);
	const bounds = (b: (typeof sorted)[number]) => b.range ?? { min: b.score, max: b.score };
	const uncertain = new Set<number>();
	for (let i = 1; i < sorted.length; i++) {
		const [a, b] = [sorted[i - 1], sorted[i]];
		if (a.peat !== b.peat || (!a.range && !b.range)) continue;
		const [ra, rb] = [bounds(a), bounds(b)];
		if (ra.max >= rb.min && rb.max >= ra.min) {
			uncertain.add(a.position);
			uncertain.add(b.position);
		}
	}
	return uncertain;
}
