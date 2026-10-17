import { describe, it, expect } from 'vitest';
import {
	checkDistilleryFacts,
	DISTILLERY_CAPACITY,
	DISTILLERY_COUNTRY_LENGTH,
	DISTILLERY_SOURCE_LENGTH,
	isHttpUrl,
	isScottishRegion,
	isValidDistillerySource,
	isValidTastingDate,
	normalizeWhiskybaseUrl,
	SCOTLAND,
	TASTING_WHISKYBASE_URL_LENGTH,
	whiskybaseId
} from './validation';

describe('isValidTastingDate', () => {
	it.each(['2026-10-24', '2028-02-29'])('accepts %s', (value) => {
		expect(isValidTastingDate(value)).toBe(true);
	});

	it.each(['', '2026-2-3', '24.10.2026', '2026-02-30', '2026-13-01', '2027-02-29', '2026-10-24x'])(
		'rejects %j',
		(value) => {
			expect(isValidTastingDate(value)).toBe(false);
		}
	);
});

describe('normalizeWhiskybaseUrl', () => {
	it.each([
		'https://www.whiskybase.com/whiskies/whisky/12345/ardbeg-uigeadail',
		'https://whiskybase.com/whiskies/whisky/12345'
	])('accepts %s', (value) => {
		expect(normalizeWhiskybaseUrl(value)).toBe(value);
	});

	it('returns the normalized URL', () => {
		expect(normalizeWhiskybaseUrl('https://WWW.Whiskybase.com')).toBe(
			'https://www.whiskybase.com/'
		);
	});

	it.each([
		['http:', 'http://www.whiskybase.com/whiskies/whisky/1'],
		['javascript:', 'javascript:alert(1)'],
		['a foreign host', 'https://evil.example/whiskies/whisky/1'],
		['a look-alike host', 'https://whiskybase.com.evil.io/whiskies'],
		['a subdomain', 'https://shop.whiskybase.com/'],
		['credentials', 'https://evil@www.whiskybase.com/'],
		['a port', 'https://www.whiskybase.com:8443/'],
		['no URL at all', 'whiskybase.com/whiskies'],
		['an empty value', '']
	])('rejects %s', (_label, value) => {
		expect(normalizeWhiskybaseUrl(value)).toBeNull();
	});

	it('rejects URLs longer than the column allows', () => {
		const base = 'https://www.whiskybase.com/';
		expect(normalizeWhiskybaseUrl(base + 'a'.repeat(TASTING_WHISKYBASE_URL_LENGTH.max))).toBeNull();
		expect(
			normalizeWhiskybaseUrl(base + 'a'.repeat(TASTING_WHISKYBASE_URL_LENGTH.max - base.length))
		).not.toBeNull();
	});
});

describe('whiskybaseId', () => {
	it.each([
		'https://www.whiskybase.com/whiskies/whisky/12345/ardbeg-uigeadail',
		'https://whiskybase.com/whiskies/whisky/12345',
		'https://www.whiskybase.com/whiskies/whisky/12345/'
	])('reads the ID from %s', (value) => {
		expect(whiskybaseId(value)).toBe('12345');
	});

	it.each([
		['a foreign host', 'https://evil.example/whiskies/whisky/12345'],
		['another Whiskybase page', 'https://www.whiskybase.com/whiskies/distillery/12345'],
		['a non-numeric ID', 'https://www.whiskybase.com/whiskies/whisky/abc'],
		['an ID followed by more digits text', 'https://www.whiskybase.com/whiskies/whisky/123abc'],
		['no URL at all', 'whiskybase.com/whiskies/whisky/12345']
	])('ignores %s', (_label, value) => {
		expect(whiskybaseId(value)).toBeNull();
	});
});

describe('isHttpUrl', () => {
	it.each(['https://scotchwhisky.com/whiskypedia/1/ardbeg/', 'http://example.com'])(
		'accepts %s',
		(value) => {
			expect(isHttpUrl(value)).toBe(true);
		}
	);

	it.each(['javascript:alert(1)', 'ftp://example.com/x', 'data:text/html,x', 'not a url', ''])(
		'rejects %s',
		(value) => {
			expect(isHttpUrl(value)).toBe(false);
		}
	);
});

describe('isValidDistillerySource', () => {
	it('limits the length of a source link', () => {
		const base = 'https://example.com/';
		const longest = base + 'a'.repeat(DISTILLERY_SOURCE_LENGTH.max - base.length);
		expect(isValidDistillerySource(longest)).toBe(true);
		expect(isValidDistillerySource(`${longest}a`)).toBe(false);
		expect(isValidDistillerySource('javascript:alert(1)')).toBe(false);
	});
});

describe('isScottishRegion', () => {
	it('knows the six regions in German spelling', () => {
		expect(isScottishRegion('Islay')).toBe(true);
		expect(isScottishRegion('Inseln')).toBe(true);
		expect(isScottishRegion('Islands')).toBe(false);
		expect(isScottishRegion('islay')).toBe(false);
	});
});

describe('checkDistilleryFacts', () => {
	const none = { country: null, region: null, capacity: null };

	it('accepts no values at all', () => {
		expect(checkDistilleryFacts(none)).toEqual({});
	});

	it('accepts a Scottish distillery with region and capacity', () => {
		expect(
			checkDistilleryFacts({ country: SCOTLAND, region: 'Islay', capacity: 2_400_000 })
		).toEqual({});
	});

	it('takes the country as free text within its length', () => {
		expect(checkDistilleryFacts({ ...none, country: 'Japan' })).toEqual({});
		const longest = 'x'.repeat(DISTILLERY_COUNTRY_LENGTH.max);
		expect(checkDistilleryFacts({ ...none, country: longest })).toEqual({});
		expect(checkDistilleryFacts({ ...none, country: `${longest}x` })).toEqual({
			country: 'invalid'
		});
		expect(checkDistilleryFacts({ ...none, country: '' })).toEqual({ country: 'invalid' });
		expect(checkDistilleryFacts({ ...none, country: ' Japan' })).toEqual({ country: 'invalid' });
	});

	it('allows a region only for exactly Schottland', () => {
		expect(checkDistilleryFacts({ ...none, country: 'Irland', region: 'Islay' })).toEqual({
			region: 'invalid'
		});
		expect(checkDistilleryFacts({ ...none, region: 'Islay' })).toEqual({ region: 'invalid' });
		expect(checkDistilleryFacts({ ...none, country: 'schottland', region: 'Islay' })).toEqual({
			region: 'invalid'
		});
		expect(checkDistilleryFacts({ ...none, country: SCOTLAND, region: 'Skye' })).toEqual({
			region: 'invalid'
		});
	});

	it('takes the capacity as a whole number in range', () => {
		expect(checkDistilleryFacts({ ...none, capacity: DISTILLERY_CAPACITY.min })).toEqual({});
		expect(checkDistilleryFacts({ ...none, capacity: DISTILLERY_CAPACITY.max })).toEqual({});
		for (const capacity of [0, -5, DISTILLERY_CAPACITY.max + 1, 1.5, Number.NaN]) {
			expect(checkDistilleryFacts({ ...none, capacity })).toEqual({ capacity: 'invalid' });
		}
	});
});
