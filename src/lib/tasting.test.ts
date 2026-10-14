import { describe, it, expect } from 'vitest';
import {
	ABV_FLOOR,
	ABV_HIGH_DIVISOR,
	ABV_HISTOGRAM_BOUNDS,
	ABV_KINK,
	ABV_KINK_FRACTION,
	ABV_LOW_DIVISOR,
	AGE_HISTOGRAM_BOUNDS,
	formatBottleName,
	formatCount,
	formatDate,
	formatInteger,
	formatNameList,
	formatOneDecimal,
	formatSmokeGroupRange,
	formatTastingDate,
	formatTastingTimestamp,
	histogramClass,
	histogramLabels,
	histogramPosition,
	normalizeScoreFactors,
	participantLabel,
	SCORE_FACTORS_BY_WEIGHT,
	smokeGroup
} from './tasting';

describe('SCORE_FACTORS_BY_WEIGHT', () => {
	it('lists the factors heaviest weight first', () => {
		expect(SCORE_FACTORS_BY_WEIGHT).toEqual(['smoke', 'cask', 'value', 'abv']);
	});
});

describe('ABV formula constants', () => {
	// The explainer tile prints the formula with these constants – it must
	// describe exactly what the normalization computes.
	it.each([40, 42.5, 46, 50, 55.5, 60, 65])(
		'reproduce the normalized share at %s %% vol',
		(abv) => {
			const shown =
				abv <= ABV_KINK
					? (abv - ABV_FLOOR) / ABV_LOW_DIVISOR
					: ABV_KINK_FRACTION + (abv - ABV_KINK) / ABV_HIGH_DIVISOR;
			expect(normalizeScoreFactors({ smoke: 0, cask: 0, abv, value: 0 }).abv).toBeCloseTo(
				shown,
				10
			);
		}
	);
});

describe('smokeGroup', () => {
	it.each([
		[0, 1],
		[1, 2],
		[2, 2],
		[3, 2],
		[4, 3],
		[5, 3]
	])('puts smoke %i into group %i', (smoke, group) => {
		expect(smokeGroup(smoke)).toBe(group);
	});
});

describe('formatSmokeGroupRange', () => {
	it.each([
		[1, '0'],
		[2, '1–3'],
		[3, '4–5']
	])('shows group %i as %s', (group, range) => {
		expect(formatSmokeGroupRange(group)).toBe(range);
	});
});

describe('formatBottleName', () => {
	it('uses only the distillery when nothing else is set', () => {
		expect(
			formatBottleName({ distillery: 'Ardbeg', age: null, bottling: null, bottler: null })
		).toBe('Ardbeg');
	});

	it('adds age and bottling', () => {
		expect(
			formatBottleName({ distillery: 'Lagavulin', age: 16, bottling: null, bottler: null })
		).toBe('Lagavulin 16 Jahre');
		expect(
			formatBottleName({ distillery: 'Ardbeg', age: null, bottling: 'Uigeadail', bottler: null })
		).toBe('Ardbeg Uigeadail');
	});

	it('appends an independent bottler in parentheses', () => {
		expect(
			formatBottleName({
				distillery: 'Caol Ila',
				age: 12,
				bottling: 'Sherry Cask',
				bottler: 'Signatory'
			})
		).toBe('Caol Ila 12 Jahre Sherry Cask (Signatory)');
	});
});

describe('participantLabel', () => {
	it('is the username of an active user', () => {
		expect(participantLabel('anna', null)).toBe('anna');
	});

	it('marks a deactivated user', () => {
		expect(participantLabel('anna', new Date('2026-10-01T12:00:00Z'))).toBe('anna (inaktiv)');
	});
});

describe('formatTastingDate', () => {
	it('formats the calendar date with weekday', () => {
		expect(formatTastingDate('2026-10-24')).toBe('Sa., 24.10.2026');
	});

	it('keeps the calendar day at a year boundary', () => {
		expect(formatTastingDate('2026-12-31')).toBe('Do., 31.12.2026');
	});
});

describe('formatTastingTimestamp', () => {
	it.each([
		// CEST (UTC+2)
		['2026-10-24T15:32:10Z', 'Sa., 24.10.2026 um 17:32 Uhr'],
		// CET (UTC+1), and already the next day in Berlin
		['2026-12-31T23:05:00Z', 'Fr., 01.01.2027 um 00:05 Uhr']
	])('formats %s in Berlin time as %s', (iso, expected) => {
		expect(formatTastingTimestamp(new Date(iso))).toBe(expected);
	});
});

describe('formatOneDecimal', () => {
	it('uses a German decimal comma with exactly one fraction digit', () => {
		expect(formatOneDecimal(46)).toBe('46,0');
		expect(formatOneDecimal(46.3)).toBe('46,3');
	});
});

describe('formatDate', () => {
	it('formats the calendar date without weekday', () => {
		expect(formatDate('2022-10-21')).toBe('21.10.2022');
		expect(formatDate('2026-12-31')).toBe('31.12.2026');
	});
});

describe('formatInteger', () => {
	it('rounds and groups thousands with a dot', () => {
		expect(formatInteger(2706.7)).toBe('2.707');
		expect(formatInteger(183.4)).toBe('183');
		expect(formatInteger(0)).toBe('0');
	});
});

describe('formatCount', () => {
	it('picks the noun by the count', () => {
		expect(formatCount(1, 'Flasche', 'Flaschen')).toBe('1 Flasche');
		expect(formatCount(0, 'Flasche', 'Flaschen')).toBe('0 Flaschen');
		expect(formatCount(1234, 'Flasche', 'Flaschen')).toBe('1.234 Flaschen');
	});
});

describe('formatNameList', () => {
	it('joins names as German prose', () => {
		expect(formatNameList(['Anna'])).toBe('Anna');
		expect(formatNameList(['Anna', 'Ben'])).toBe('Anna und Ben');
		expect(formatNameList(['Anna', 'Ben', 'Cem'])).toBe('Anna, Ben und Cem');
	});
});

describe('histogram classes', () => {
	it('labels the ABV classes with one decimal and open ends', () => {
		expect(histogramLabels(ABV_HISTOGRAM_BOUNDS, 0.1)).toEqual([
			'< 43',
			'43–45,9',
			'46–49,9',
			'50–54,9',
			'55–59,9',
			'≥ 60'
		]);
	});

	it('labels the age classes in whole years', () => {
		expect(histogramLabels(AGE_HISTOGRAM_BOUNDS, 1)).toEqual([
			'< 6',
			'6–9',
			'10–14',
			'15–19',
			'≥ 20'
		]);
	});

	it.each([
		[40, 0],
		[42.9, 0],
		[43, 1],
		[45.9, 1],
		[46, 2],
		[54.9, 3],
		[55, 4],
		[60, 5],
		[66.6, 5]
	])('puts %s %% vol into class %i', (abv, index) => {
		expect(histogramClass(abv, ABV_HISTOGRAM_BOUNDS)).toBe(index);
	});

	it('places a value linearly inside its class', () => {
		const range = { min: 35, max: 75 };
		expect(histogramPosition(50.6, ABV_HISTOGRAM_BOUNDS, range)).toBeCloseTo(3.12);
		expect(histogramPosition(43, ABV_HISTOGRAM_BOUNDS, range)).toBe(1);
		// The open classes reach to the bounds of the input.
		expect(histogramPosition(39, ABV_HISTOGRAM_BOUNDS, range)).toBeCloseTo(0.5);
		expect(histogramPosition(75, ABV_HISTOGRAM_BOUNDS, range)).toBe(6);
		expect(histogramPosition(30, ABV_HISTOGRAM_BOUNDS, range)).toBe(0);
	});
});
