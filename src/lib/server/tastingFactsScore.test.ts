import { describe, expect, it } from 'vitest';
import { FACTS_RULES, type BottleFacts, type FactsScoreRules } from '$lib/tastingFacts';
import { caskScore, factsShares, scoreFacts, sortFactsForPouring } from './tastingFactsScore';

const REFILL_BOURBON = { kind: 'known', type: 'bourbon', refill: true } as const;
const BOURBON = { kind: 'known', type: 'bourbon', refill: false } as const;
const OLOROSO = { kind: 'known', type: 'sherry_oloroso', refill: false } as const;
const PX = { kind: 'known', type: 'sherry_px', refill: false } as const;

function facts(overrides: Partial<BottleFacts> = {}): BottleFacts {
	return {
		peat: 'none',
		cask: REFILL_BOURBON,
		finish: { kind: 'none' },
		priceCents: 3500,
		...overrides
	};
}

function bottle(abv: number, f: BottleFacts, distillery = 'Glen Test') {
	return { abv, facts: f, distillery, age: null, bottling: null, bottler: null };
}

const score = (abv: number, f: BottleFacts) => scoreFacts({ abv, facts: f }, FACTS_RULES).score;

describe('scoreFacts – the test cases of issue #52', () => {
	it.each([
		['Speysider, Ex-Bourbon Refill', 40, facts(), 13.8],
		['18 J., Ex-Bourbon Refill', 46, facts({ priceCents: 15000 }), 39.0],
		[
			'Oloroso 12 J., Refill',
			46,
			facts({ cask: { ...OLOROSO, refill: true }, priceCents: 6000 }),
			43.8
		],
		['Oloroso 12 J.', 46, facts({ cask: OLOROSO, priceCents: 6000 }), 53.8],
		[
			'Ex-Bourbon + 12 Mon. PX',
			46,
			facts({ cask: BOURBON, finish: { ...PX, months: 12 }, priceCents: 7000 }),
			63.0
		],
		['PX, Fassstärke', 58, facts({ cask: PX, priceCents: 15000 }), 92.0],
		['Islay, Ex-Bourbon', 46, facts({ peat: 'heavy', cask: BOURBON, priceCents: 5500 }), 37.8]
	])('%s → %d', (_name, abv, f, expected) => {
		expect(score(abv, f)).toBe(expected);
	});

	it('scores an unknown price without it: the other weights scale up (Oloroso → 55,0)', () => {
		const result = scoreFacts(
			{ abv: 46, facts: facts({ cask: OLOROSO, priceCents: null }) },
			FACTS_RULES
		);
		expect(result.score).toBe(55.0);
		expect(result.shares.price).toBeNull();
	});
});

describe('factsShares', () => {
	it('normalizes the ABV linearly between 40 and 60 % vol, clamped', () => {
		const abv = (value: number) => factsShares(0, value, null, FACTS_RULES).abv;
		expect([38, 40, 46, 50, 60, 65].map(abv)).toEqual([0, 0, 0.3, 0.5, 1, 1]);
	});

	it('normalizes the price logarithmically between 25 and 150 €, clamped', () => {
		const price = (euros: number) =>
			Math.round(factsShares(0, 40, euros * 100, FACTS_RULES).price! * 1000) / 1000;
		expect([15, 25, 35, 50, 100, 150, 300].map(price)).toEqual([0, 0, 0.188, 0.387, 0.774, 1, 1]);
	});

	it('scales the cask score to 0–1', () => {
		expect(factsShares(7, 40, null, FACTS_RULES).cask).toBe(0.7);
	});
});

describe('caskScore', () => {
	it('adds a finish with base × 0.5 × duration factor', () => {
		const port = { kind: 'known', type: 'port', months: 3 } as const;
		expect(caskScore(facts({ finish: { ...port, refill: false } }), FACTS_RULES)).toBe(2.75);
		expect(caskScore(facts({ finish: { ...port, refill: true } }), FACTS_RULES)).toBe(2.5);
	});

	it('counts a finish without a duration with factor 0.5 and caps the duration at 12 months', () => {
		expect(caskScore(facts({ finish: { ...PX, months: null } }), FACTS_RULES)).toBe(4.25);
		expect(caskScore(facts({ finish: { ...PX, months: 36 } }), FACTS_RULES)).toBe(6.5);
	});

	it('caps the cask score at 10', () => {
		expect(caskScore(facts({ cask: PX, finish: { ...PX, months: 12 } }), FACTS_RULES)).toBe(10);
	});

	it('takes the rating of an other cask instead of a base value', () => {
		const other = (influence: number) =>
			caskScore(facts({ cask: { kind: 'other', label: 'Tequila', influence } }), FACTS_RULES);
		expect([other(0), other(10)]).toEqual([0, 10]);
		const finish = { kind: 'other', label: 'Mizunara', influence: 6, months: 6 } as const;
		expect(caskScore(facts({ finish }), FACTS_RULES)).toBe(3.5);
	});

	it('uses 4 for an unknown main maturation and 0 for an unknown finish', () => {
		expect(caskScore(facts({ cask: { kind: 'unknown' } }), FACTS_RULES)).toBe(4);
		expect(caskScore(facts({ finish: { kind: 'unknown' } }), FACTS_RULES)).toBe(2);
	});

	it('ignores a refill on a cask the rules can not refill (virgin oak)', () => {
		const virgin = { kind: 'known', type: 'virgin_oak', refill: true } as const;
		expect(caskScore(facts({ cask: virgin }), FACTS_RULES)).toBe(7);
	});

	it('fails on a cask type the rules do not know', () => {
		const rules: FactsScoreRules = { ...FACTS_RULES, cask: { ...FACTS_RULES.cask, types: [] } };
		expect(() => caskScore(facts(), rules)).toThrow('cask type bourbon missing in the rules');
	});
});

describe('scoreFacts – range', () => {
	it('has no range when both casks are known', () => {
		expect(scoreFacts({ abv: 40, facts: facts() }, FACTS_RULES).range).toBeNull();
	});

	it('spans 2–9 for an unknown main maturation (Speysider: 13,8 / 23,8 / 48,8)', () => {
		const result = scoreFacts(
			{ abv: 40, facts: facts({ cask: { kind: 'unknown' } }) },
			FACTS_RULES
		);
		expect(result.score).toBe(23.8);
		expect(result.range).toEqual({ min: 13.8, max: 48.8 });
	});

	it('spans 0 to a full PX finish (+4,5) for an unknown finish', () => {
		const result = scoreFacts(
			{ abv: 40, facts: facts({ finish: { kind: 'unknown' }, priceCents: 2500 }) },
			FACTS_RULES
		);
		// Cask 2 → 10 points, cask 6.5 → 32.5 points.
		expect(result.range).toEqual({ min: 10, max: 32.5 });
	});

	it('caps the range at a cask score of 10 when both are unknown', () => {
		const result = scoreFacts(
			{
				abv: 40,
				facts: facts({ cask: { kind: 'unknown' }, finish: { kind: 'unknown' }, priceCents: 2500 })
			},
			FACTS_RULES
		);
		expect(result.range).toEqual({ min: 10, max: 50 });
	});

	it('scales the range without a price like the score', () => {
		const result = scoreFacts(
			{ abv: 40, facts: facts({ cask: { kind: 'unknown' }, priceCents: null }) },
			FACTS_RULES
		);
		expect(result.range).toEqual({ min: 12.5, max: 56.3 });
	});
});

describe('scoreFacts – takes the rules as a parameter', () => {
	it('computes with other weights, tables and scales', () => {
		const rules: FactsScoreRules = {
			...FACTS_RULES,
			factors: [
				{ key: 'cask', weight: 1 },
				{ key: 'abv', weight: 0 },
				{ key: 'price', weight: 0 }
			],
			cask: {
				...FACTS_RULES.cask,
				types: FACTS_RULES.cask.types.map((t) => (t.key === 'bourbon' ? { ...t, base: 8 } : t)),
				refillPenalty: 4
			}
		};
		expect(scoreFacts({ abv: 60, facts: facts() }, rules).score).toBe(40);
	});
});

describe('sortFactsForPouring', () => {
	it('pours by peat group, then by Wucht – the issue example', () => {
		const sorted = sortFactsForPouring(
			[
				bottle(46, facts({ peat: 'heavy', cask: BOURBON, priceCents: 5500 }), 'Islay'),
				bottle(58, facts({ cask: PX, priceCents: 15000 }), 'PX'),
				bottle(40, facts(), 'Speyside'),
				bottle(46, facts({ cask: OLOROSO, priceCents: 6000 }), 'Oloroso'),
				bottle(46, facts({ priceCents: 3500, peat: 'light' }), 'Leicht')
			],
			FACTS_RULES
		);
		expect(sorted.map((b) => [b.distillery, b.score])).toEqual([
			['Speyside', 13.8],
			['Oloroso', 53.8],
			['PX', 92],
			['Leicht', 22.8],
			['Islay', 37.8]
		]);
	});

	it('breaks a tie by ABV, then price (unknown last), then the name', () => {
		const sameScore = (abv: number, priceCents: number | null, name: string) =>
			bottle(abv, facts({ cask: { kind: 'other', label: 'x', influence: 0 }, priceCents }), name);
		// All score 0: no cask influence, ABV ≤ 40, price ≤ 25 € or unknown.
		const sorted = sortFactsForPouring(
			[
				sameScore(40, null, 'A'),
				sameScore(39, 2000, 'B'),
				sameScore(40, 2000, 'D'),
				sameScore(40, 2000, 'C'),
				sameScore(40, 1500, 'E')
			],
			FACTS_RULES
		);
		expect(sorted.map((b) => b.score)).toEqual([0, 0, 0, 0, 0]);
		expect(sorted.map((b) => b.distillery)).toEqual(['B', 'E', 'C', 'D', 'A']);
	});

	it('puts an unknown price last also when it is the second one', () => {
		const zero = { kind: 'other', label: 'x', influence: 0 } as const;
		const sorted = sortFactsForPouring(
			[
				bottle(40, facts({ cask: zero, priceCents: 2000 }), 'Z'),
				bottle(40, facts({ cask: zero, priceCents: null }), 'A')
			],
			FACTS_RULES
		);
		expect(sorted.map((b) => b.distillery)).toEqual(['Z', 'A']);
	});

	it('follows the tie-breakers of the rules', () => {
		const zero = { kind: 'other', label: 'x', influence: 0 } as const;
		const sorted = sortFactsForPouring(
			[
				bottle(39, facts({ cask: zero, priceCents: 2000 }), 'A'),
				bottle(38, facts({ cask: zero, priceCents: 1500 }), 'B')
			],
			{ ...FACTS_RULES, tieBreakers: ['price', 'abv'] }
		);
		expect(sorted.map((b) => b.distillery)).toEqual(['B', 'A']);
	});
});
