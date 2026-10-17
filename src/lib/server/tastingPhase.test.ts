import { describe, it, expect } from 'vitest';
import {
	getBerlinDateTime,
	getBerlinToday,
	getTastingPhase,
	isTastingReleased,
	nextBerlinTime
} from './tastingPhase';

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

describe('isTastingReleased', () => {
	const none = { orderOpenedAt: null, revealedAt: null };

	it.each([
		// Summer (CEST): 21:00 Berlin = 19:00 UTC.
		['2026-06-20', '2026-06-20T18:59:59Z', false],
		['2026-06-20', '2026-06-20T19:00:00Z', true],
		// The night after: still the order phase, but released.
		['2026-06-20', '2026-06-20T23:30:00Z', true],
		['2026-06-20', '2026-06-21T06:00:00Z', true],
		['2026-06-20', '2026-07-01T10:00:00Z', true],
		['2026-06-20', '2026-06-19T20:00:00Z', false],
		// Winter (CET): 21:00 Berlin = 20:00 UTC.
		['2026-12-12', '2026-12-12T19:59:59Z', false],
		['2026-12-12', '2026-12-12T20:00:00Z', true],
		// Fall back on 25.10.2026 as the tasting day.
		['2026-10-25', '2026-10-25T19:59:59Z', false],
		['2026-10-25', '2026-10-25T20:00:00Z', true]
	])('tasting on %s at %s: %s', (date, iso, released) => {
		expect(isTastingReleased(date, new Date(iso), none)).toBe(released);
	});

	it('releases a tasting revealed early, not one with the order opened early', () => {
		const now = new Date('2026-06-20T17:00:00Z'); // 19:00 Berlin
		expect(isTastingReleased('2026-06-20', now, { orderOpenedAt: now, revealedAt: null })).toBe(
			false
		);
		expect(isTastingReleased('2026-06-20', now, { orderOpenedAt: now, revealedAt: now })).toBe(
			true
		);
	});
});

describe('nextBerlinTime', () => {
	it.each([
		// CEST: 21:00 Berlin = 19:00 UTC.
		['2026-06-20T10:00:00Z', '2026-06-20T19:00:00.000Z'],
		// From exactly 21:00 on, the next day counts.
		['2026-06-20T19:00:00Z', '2026-06-21T19:00:00.000Z'],
		['2026-06-20T19:00:01Z', '2026-06-21T19:00:00.000Z'],
		// After midnight Berlin, still the previous day in UTC.
		['2026-06-20T22:30:00Z', '2026-06-21T19:00:00.000Z'],
		// CET: 21:00 Berlin = 20:00 UTC.
		['2026-12-31T21:00:00Z', '2027-01-01T20:00:00.000Z'],
		// Spring forward on 29.03.2026: before it CET, after it CEST.
		['2026-03-28T20:00:00Z', '2026-03-29T19:00:00.000Z'],
		['2026-03-29T01:30:00Z', '2026-03-29T19:00:00.000Z'],
		// Fall back on 25.10.2026: before it CEST, after it CET.
		['2026-10-24T19:00:00Z', '2026-10-25T20:00:00.000Z'],
		['2026-10-25T00:30:00Z', '2026-10-25T20:00:00.000Z']
	])('after %s comes %s', (iso, next) => {
		expect(nextBerlinTime(new Date(iso), 21).toISOString()).toBe(next);
	});

	it('works for any hour', () => {
		expect(nextBerlinTime(new Date('2026-06-20T10:00:00Z'), 9).toISOString()).toBe(
			'2026-06-21T07:00:00.000Z'
		);
	});
});
