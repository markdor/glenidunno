import { describe, it, expect } from 'vitest';
import {
	isValidTastingDate,
	normalizeWhiskybaseUrl,
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
