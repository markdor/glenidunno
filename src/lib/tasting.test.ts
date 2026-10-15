import { describe, it, expect } from 'vitest';
import {
	ABV_FLOOR,
	ABV_HIGH_DIVISOR,
	ABV_HISTOGRAM,
	ABV_KINK,
	ABV_KINK_FRACTION,
	ABV_LOW_DIVISOR,
	AGE_HISTOGRAM,
	formatBottleName,
	formatCount,
	formatDate,
	formatInteger,
	formatNameList,
	formatOneDecimal,
	formatSmokeGroupRange,
	formatTastingDate,
	formatTastingTimestamp,
	HISTOGRAM_BAR_PX,
	histogramBarHeight,
	histogramBoundIndex,
	histogramIntervals,
	histogramPosition,
	isLabeled,
	isViewablePresentation,
	labelStep,
	normalizeScoreFactors,
	participantLabel,
	SCORE_FACTORS_BY_WEIGHT,
	smokeGroup,
	visibleCounts,
	type HistogramInterval
} from './tasting';

describe('SCORE_FACTORS_BY_WEIGHT', () => {
	it('lists the factors heaviest weight first', () => {
		expect(SCORE_FACTORS_BY_WEIGHT).toEqual(['smoke', 'cask', 'value', 'abv']);
	});
});

describe('isViewablePresentation', () => {
	it.each(['pdf', 'pptx', 'ppt', 'odp', 'docx', 'doc', 'odt', 'PPTX'])(
		'shows a .%s file in the viewer',
		(extension) => {
			expect(isViewablePresentation(`Tasting_2026-10-24_Nebel.${extension}`)).toBe(true);
		}
	);

	it.each([
		'Tasting_2026-10-24_Nebel.zip',
		'Tasting_2026-10-24_Nebel.key',
		'Tasting_2026-10-24_Nebel'
	])('only offers the download for %s', (file) => {
		expect(isViewablePresentation(file)).toBe(false);
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

describe('histogram intervals', () => {
	const WIDTHS = [1, 2, 3, 4, 5];
	const starts = (intervals: HistogramInterval[]) => intervals.map((i) => i.start);

	it.each(WIDTHS)('keeps 46 %% vol a bound at a width of %i', (width) => {
		const intervals = histogramIntervals([40, 45.9, 46, 66.6], ABV_HISTOGRAM, width);
		expect(starts(intervals)).toContain(46);
		// 45.9 just below, 46.0 at the start of the next interval.
		const below = intervals.find((i) => i.start <= 45.9 && 45.9 < i.end)!;
		expect(below.end).toBe(46);
	});

	it.each(WIDTHS)('keeps 3 years a bound at a width of %i', (width) => {
		expect(starts(histogramIntervals([3, 24], AGE_HISTOGRAM, width))[0]).toBe(3);
	});

	it('reaches from the interval of the lowest to that of the highest value', () => {
		const abvs = [40, 42.5, 46, 46.9, 46, 59.3, 66.6];
		const intervals = histogramIntervals(abvs, ABV_HISTOGRAM, 1);
		// 27 bars from 40 to 67, like the history at 1 %-point.
		expect(intervals).toHaveLength(27);
		expect(intervals[0]).toEqual({ start: 40, end: 41, count: 1 });
		expect(intervals.at(-1)).toEqual({ start: 66, end: 67, count: 1 });
		expect(intervals.find((i) => i.start === 46)!.count).toBe(3);
		// Empty intervals stay in between.
		expect(intervals.find((i) => i.start === 41)!.count).toBe(0);
		expect(intervals.reduce((sum, i) => sum + i.count, 0)).toBe(abvs.length);
	});

	it('is half-open and counts in tenths, so float noise moves nothing', () => {
		// 0.1 * 3 is 0.30000000000000004 – rounded to tenths it is 46.3.
		const intervals = histogramIntervals([45.9, 46, 46 + 0.1 * 3, 49.9, 50], ABV_HISTOGRAM, 4);
		expect(intervals).toEqual([
			{ start: 42, end: 46, count: 1 },
			{ start: 46, end: 50, count: 3 },
			{ start: 50, end: 54, count: 1 }
		]);
	});

	it('puts a single value into a single interval', () => {
		expect(histogramIntervals([12], AGE_HISTOGRAM, 3)).toEqual([{ start: 12, end: 15, count: 1 }]);
		expect(histogramIntervals([], AGE_HISTOGRAM, 3)).toEqual([]);
	});

	it('puts ages below 3 into the intervals below it, without a special case', () => {
		expect(histogramIntervals([1, 2, 3], AGE_HISTOGRAM, 1)).toEqual([
			{ start: 1, end: 2, count: 1 },
			{ start: 2, end: 3, count: 1 },
			{ start: 3, end: 4, count: 1 }
		]);
		expect(histogramIntervals([1, 4], AGE_HISTOGRAM, 3)).toEqual([
			{ start: 0, end: 3, count: 1 },
			{ start: 3, end: 6, count: 1 }
		]);
	});

	it('finds the index of a bound, also outside the intervals', () => {
		const intervals = histogramIntervals([40, 66.6], ABV_HISTOGRAM, 2);
		expect(intervals[0].start).toBe(40);
		expect(histogramBoundIndex(46, intervals)).toBe(3);
		// Ages from 10 on at a width of 3: the anchor 3 lies left of the chart.
		expect(histogramBoundIndex(3, histogramIntervals([10, 20], AGE_HISTOGRAM, 3))).toBe(-2);
		expect(histogramBoundIndex(46, [])).toBe(0);
	});

	it('places a value linearly inside its interval', () => {
		const ages = histogramIntervals([3, 11, 24], AGE_HISTOGRAM, 1);
		// 11.2 sits in the bar of 11 years at a fifth of its width.
		expect(histogramPosition(11.2, ages)).toBeCloseTo(8.2);
		expect(histogramPosition(50.6, histogramIntervals([40, 66.6], ABV_HISTOGRAM, 4))).toBeCloseTo(
			3.15
		);
		// Kept on the axis, also without intervals.
		expect(histogramPosition(1, ages)).toBe(0);
		expect(histogramPosition(30, ages)).toBe(ages.length);
		expect(histogramPosition(11.2, [])).toBe(0);
	});

	it('scales the bars to the highest count', () => {
		expect(histogramBarHeight(28, 28)).toBe(HISTOGRAM_BAR_PX);
		expect(histogramBarHeight(7, 28)).toBe(HISTOGRAM_BAR_PX / 4);
		expect(histogramBarHeight(0, 0)).toBe(0);
	});
});

describe('histogram labels', () => {
	const BOUNDS = Array.from({ length: 28 }, (_, i) => String(40 + i));

	it('shows every label while they fit, every k-th with the smallest k otherwise', () => {
		// 2 digits need 29 px: all at 30 px, every other at 26 px (a desktop at 1 %-point).
		expect(labelStep(BOUNDS, 30)).toBe(1);
		expect(labelStep(BOUNDS, 26)).toBe(2);
		expect(labelStep(BOUNDS, 10)).toBe(3);
		// The longest label decides.
		expect(labelStep(['3–5', '6–8', '9–11'], 30)).toBe(2);
		expect(labelStep([], 30)).toBe(1);
	});

	it('always labels the anchor and counts the step from it', () => {
		const anchor = 6;
		const labeled = BOUNDS.filter((_, i) => isLabeled(i, anchor, 4));
		expect(labeled).toEqual(['42', '46', '50', '54', '58', '62', '66']);
		expect(isLabeled(anchor, anchor, 3)).toBe(true);
		// An anchor left of the chart still sets the rhythm.
		expect([0, 1, 2, 3, 4].filter((i) => isLabeled(i, -2, 3))).toEqual([1, 4]);
		expect(isLabeled(5, 0, 1)).toBe(true);
	});
});

describe('visibleCounts', () => {
	it('shows every count while there is room and none for an empty interval', () => {
		expect(visibleCounts([1, 28, 0, 10, 3], 28, 26)).toEqual([true, true, false, true, true]);
	});

	it('keeps the counts of the highest bars when they collide', () => {
		// 11 px per column: two-digit counts of neighbours at the same height collide.
		expect(visibleCounts([27, 28, 26, 25], 28, 11)).toEqual([false, true, false, true]);
		// Ties keep the leftmost first.
		expect(visibleCounts([20, 20], 20, 11)).toEqual([true, false]);
	});

	it('keeps neighbouring counts at clearly different heights', () => {
		// 28 ends 96 px up, 3 only 10 px: one sits far above the other.
		expect(visibleCounts([28, 3], 28, 11)).toEqual([true, true]);
	});

	it('drops a count that would overlap one shown further away', () => {
		// Three digits are wider than a column: the neighbour's neighbour collides too.
		expect(visibleCounts([100, 0, 100], 100, 11)).toEqual([true, false, false]);
		expect(visibleCounts([100, 0, 100], 100, 20)).toEqual([true, false, true]);
	});
});
