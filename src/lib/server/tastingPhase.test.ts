import { describe, it, expect } from 'vitest';
import { getBerlinDateTime, getBerlinToday, getTastingPhase } from './tastingPhase';

// All instants are given in UTC: the result must not depend on the time zone
// of the machine running the tests (CI runs in UTC, locally usually Berlin).

describe('getBerlinDateTime', () => {
	it.each([
		// CEST (UTC+2)
		['2026-06-20T15:59:59Z', '2026-06-20', 17],
		// Just after midnight Berlin is still the previous day in UTC.
		['2026-06-19T22:30:00Z', '2026-06-20', 0],
		// CET (UTC+1)
		['2026-12-31T23:30:00Z', '2027-01-01', 0]
	])('%s is %s, hour %i in Berlin', (iso, date, hour) => {
		expect(getBerlinDateTime(new Date(iso))).toEqual({ date, hour });
	});

	it('returns the Berlin calendar date as today', () => {
		expect(getBerlinToday(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
	});
});

describe('getTastingPhase', () => {
	it.each([
		// Regular summer day (CEST): 18:00 Berlin = 16:00 UTC, 9:00 = 7:00 UTC.
		['2026-06-20', '2026-06-01T10:00:00Z', 'entry'],
		['2026-06-20', '2026-06-20T15:59:59Z', 'entry'],
		['2026-06-20', '2026-06-20T16:00:00Z', 'order'],
		['2026-06-20', '2026-06-21T06:59:59Z', 'order'],
		['2026-06-20', '2026-06-21T07:00:00Z', 'revealed'],
		['2026-06-20', '2026-07-01T10:00:00Z', 'revealed'],
		// Spring forward on 29.03.2026 as the tasting day (CEST from 3:00).
		['2026-03-29', '2026-03-29T15:59:59Z', 'entry'],
		['2026-03-29', '2026-03-29T16:00:00Z', 'order'],
		// ... and as the day after (tasting day still CET).
		['2026-03-28', '2026-03-28T16:59:59Z', 'entry'],
		['2026-03-28', '2026-03-28T17:00:00Z', 'order'],
		['2026-03-28', '2026-03-29T06:59:59Z', 'order'],
		['2026-03-28', '2026-03-29T07:00:00Z', 'revealed'],
		// Fall back on 25.10.2026 as the tasting day (CET from 3:00).
		['2026-10-25', '2026-10-25T16:59:59Z', 'entry'],
		['2026-10-25', '2026-10-25T17:00:00Z', 'order'],
		// ... and as the day after (tasting day still CEST).
		['2026-10-24', '2026-10-24T15:59:59Z', 'entry'],
		['2026-10-24', '2026-10-24T16:00:00Z', 'order'],
		['2026-10-24', '2026-10-25T07:59:59Z', 'order'],
		['2026-10-24', '2026-10-25T08:00:00Z', 'revealed'],
		// The day after crosses a month and year boundary.
		['2026-12-31', '2027-01-01T07:59:59Z', 'order'],
		['2026-12-31', '2027-01-01T08:00:00Z', 'revealed']
	])('tasting on %s at %s is in phase %s', (tastingDate, iso, phase) => {
		expect(getTastingPhase(tastingDate, new Date(iso))).toBe(phase);
	});

	describe('manual changes by the admin', () => {
		const pressed = new Date('2026-06-20T10:00:00Z');
		const beforeEntryEnds = new Date('2026-06-20T12:00:00Z');
		const duringOrder = new Date('2026-06-20T20:00:00Z');

		it('opens the order before 18:00 with the 18-Uhr button', () => {
			expect(
				getTastingPhase('2026-06-20', beforeEntryEnds, { orderOpenedAt: pressed, revealedAt: null })
			).toBe('order');
		});

		it('reveals right away with the 9-Uhr button, even from the entry phase', () => {
			expect(
				getTastingPhase('2026-06-20', beforeEntryEnds, { orderOpenedAt: null, revealedAt: pressed })
			).toBe('revealed');
			expect(
				getTastingPhase('2026-06-20', duringOrder, { orderOpenedAt: pressed, revealedAt: pressed })
			).toBe('revealed');
		});

		it('never holds the clock back', () => {
			// Order opened early, the reveal still comes at 9:00 the next day.
			expect(
				getTastingPhase('2026-06-20', new Date('2026-06-21T07:00:00Z'), {
					orderOpenedAt: pressed,
					revealedAt: null
				})
			).toBe('revealed');
		});

		it('keeps the clock rules without any button pressed', () => {
			expect(
				getTastingPhase('2026-06-20', beforeEntryEnds, { orderOpenedAt: null, revealedAt: null })
			).toBe('entry');
		});
	});
});
