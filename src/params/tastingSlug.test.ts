import { describe, it, expect } from 'vitest';
import { match } from './tastingSlug';

describe('tastingSlug param matcher', () => {
	it('accepts <adjective>-<animal>', () => {
		expect(match('fluffy-otter')).toBe(true);
	});

	it.each([
		['an empty value', ''],
		['a single word', 'otter'],
		['three words', 'very-fluffy-otter'],
		['an empty word', '-otter'],
		['upper-case letters', 'Fluffy-otter'],
		['digits', 'fluffy-otter2'],
		['an underscore', 'fluffy_otter'],
		['a non-ASCII letter', 'flauschig-möwe'],
		['an old token link', 'abcdefghijklmnopqrstuvwxyzAB_-09']
	])('rejects %s', (_label, value) => {
		expect(match(value)).toBe(false);
	});
});
