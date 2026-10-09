import { describe, it, expect } from 'vitest';
import {
	ABV_FLOOR,
	ABV_HIGH_DIVISOR,
	ABV_KINK,
	ABV_KINK_FRACTION,
	ABV_LOW_DIVISOR,
	formatBottleName,
	formatOneDecimal,
	formatSmokeGroupRange,
	formatTastingDate,
	formatTastingTimestamp,
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
