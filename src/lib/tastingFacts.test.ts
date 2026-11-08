import { describe, expect, it } from 'vitest';
import { pouringGroupLabel, SCORE_RULES } from '$lib/tasting';
import {
	CASKS,
	FACTS_RULES,
	formatCask,
	formatFinish,
	formatNumber,
	formatPrice,
	formatRange,
	isRefillable,
	peatLevel,
	uncertainPositions
} from './tastingFacts';

describe('FACTS_RULES', () => {
	it('holds everything the order is computed with', () => {
		expect(FACTS_RULES).toMatchObject({
			version: 2,
			peatGroups: [
				{ key: 'none', label: 'ungetorft' },
				{ key: 'light', label: 'leicht getorft' },
				{ key: 'heavy', label: 'stark getorft' }
			],
			factors: [
				{ key: 'cask', weight: 0.5 },
				{ key: 'abv', weight: 0.3 },
				{ key: 'price', weight: 0.2 }
			],
			cask: {
				max: 10,
				refillPenalty: 2,
				influence: { min: 0, max: 10 },
				finishFactor: 0.5,
				finishFullMonths: 12,
				unknownDurationFactor: 0.5,
				unknown: { cask: 4, finish: 0 },
				unknownRange: { cask: { min: 2, max: 9 }, finish: { min: 0, max: 9 } }
			},
			abv: { floor: 40, ceiling: 60 },
			price: { floor: 25, ceiling: 150 },
			tieBreakers: ['abv', 'price']
		});
	});

	it('lists the cask table of the issue, virgin oak without refill', () => {
		expect(
			Object.fromEntries(FACTS_RULES.cask.types.map((t) => [t.key, [t.base, t.refill]]))
		).toEqual({
			bourbon: [4, true],
			sherry_fino: [4, true],
			sherry_oloroso: [7, true],
			sherry: [7, true],
			sherry_px: [9, true],
			red_wine: [6, true],
			port: [6, true],
			madeira: [5, true],
			rum: [5, true],
			cognac: [5, true],
			virgin_oak: [7, false]
		});
		expect(isRefillable('virgin_oak')).toBe(false);
		expect(CASKS.sherry_px.label).toBe('Sherry PX');
	});

	it('survives JSON, as it is frozen with the order', () => {
		expect(JSON.parse(JSON.stringify(FACTS_RULES))).toEqual(FACTS_RULES);
	});
});

describe('pouringGroupLabel', () => {
	it('names the groups of either algorithm, none without groups', () => {
		expect(pouringGroupLabel(SCORE_RULES)).toBe('Rauchgruppe');
		expect(pouringGroupLabel({ ...SCORE_RULES, smokeGroups: [] })).toBeNull();
		expect(pouringGroupLabel(FACTS_RULES)).toBe('Torfgruppe');
		expect(pouringGroupLabel({ ...FACTS_RULES, peatGroups: [] })).toBeNull();
	});
});

describe('display helpers', () => {
	it('names casks, refill and other casks', () => {
		expect(formatCask({ kind: 'known', type: 'bourbon', refill: false })).toBe('Ex-Bourbon');
		expect(formatCask({ kind: 'known', type: 'sherry_px', refill: true })).toBe(
			'Sherry PX (Refill)'
		);
		expect(formatCask({ kind: 'other', label: 'Tequila', influence: 4 })).toBe(
			'Tequila (Einfluss 4 von 10)'
		);
		expect(formatCask({ kind: 'unknown' })).toBe('unbekannt');
	});

	it('names a finish with its duration', () => {
		expect(formatFinish({ kind: 'none' })).toBe('keine');
		expect(formatFinish({ kind: 'unknown' })).toBe('unbekannt');
		expect(formatFinish({ kind: 'known', type: 'port', refill: false, months: 1 })).toBe(
			'Port, 1 Monat'
		);
		expect(formatFinish({ kind: 'known', type: 'port', refill: true, months: 18 })).toBe(
			'Port (Refill), 18 Monate'
		);
		expect(formatFinish({ kind: 'other', label: 'Bier', influence: 5, months: null })).toBe(
			'Bier (Einfluss 5 von 10), Dauer unbekannt'
		);
	});

	it('formats prices, numbers and ranges in German', () => {
		expect(formatPrice(4990).replace(/\s/g, ' ')).toBe('49,90 €');
		expect(formatPrice(null)).toBe('unbekannt');
		expect([0.5, 12, 4.25].map(formatNumber)).toEqual(['0,5', '12', '4,25']);
		expect(formatRange({ min: 13.8, max: 48.75 })).toBe('13,8–48,8');
	});

	it('names the peat levels', () => {
		expect(peatLevel('heavy')).toEqual({ key: 'heavy', answer: 'stark', group: 'stark getorft' });
	});
});

describe('uncertainPositions', () => {
	const bottle = (
		position: number,
		score: number,
		range: { min: number; max: number } | null = null,
		peat: 'none' | 'heavy' = 'none'
	) => ({ position, score, range, peat });

	it('marks both neighbors whose ranges overlap', () => {
		expect(uncertainPositions([bottle(1, 20), bottle(2, 30, { min: 15, max: 50 })])).toEqual(
			new Set([1, 2])
		);
		expect(
			uncertainPositions([bottle(2, 30, { min: 25, max: 40 }), bottle(3, 35, { min: 33, max: 60 })])
		).toEqual(new Set([2, 3]));
	});

	it('marks nothing for ranges apart, for certain bottles or across peat groups', () => {
		expect(uncertainPositions([bottle(1, 10), bottle(2, 30, { min: 20, max: 40 })])).toEqual(
			new Set()
		);
		// Two certain bottles with the same score: the tie-breakers decide, no doubt.
		expect(uncertainPositions([bottle(1, 30), bottle(2, 30)])).toEqual(new Set());
		expect(
			uncertainPositions([bottle(1, 50, { min: 10, max: 90 }), bottle(2, 20, null, 'heavy')])
		).toEqual(new Set());
	});

	it('compares neighbors in pouring order only', () => {
		expect(
			uncertainPositions([bottle(3, 60), bottle(1, 10, { min: 5, max: 70 }), bottle(2, 30)])
		).toEqual(new Set([1, 2]));
	});
});
