import { describe, it, expect } from 'vitest';
import { NOT_FOUND_LOCATION, NOTICES, parseNotice } from './notices';

describe('parseNotice', () => {
	it('passes through a whitelisted notice', () => {
		expect(parseNotice('not-found')).toBe('not-found');
		expect(NOTICES['not-found']).toBe('Diese Seite gibt es nicht (mehr).');
	});

	it.each(['', 'NOT-FOUND', 'forbidden', '<script>', 'toString', '__proto__', 'constructor'])(
		'drops the unknown value %j',
		(value) => {
			expect(parseNotice(value)).toBeNull();
		}
	);

	it('returns null without a parameter', () => {
		expect(parseNotice(null)).toBeNull();
	});
});

describe('NOT_FOUND_LOCATION', () => {
	it('points to the dashboard with the not-found notice', () => {
		const url = new URL(NOT_FOUND_LOCATION, 'http://localhost');
		expect(url.pathname).toBe('/');
		expect(parseNotice(url.searchParams.get('notice'))).toBe('not-found');
	});
});
