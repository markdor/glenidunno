import { describe, it, expect } from 'vitest';
import {
	formatBottleName,
	formatOneDecimal,
	formatTastingDate,
	formatTastingTimestamp
} from './tasting';

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
