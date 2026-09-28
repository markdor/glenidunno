import { describe, it, expect } from 'vitest';
import { match } from './tastingToken';

describe('tastingToken param matcher', () => {
	it('accepts a well-formed token', () => {
		expect(match('abcdefghijklmnopqrstuvwxyzAB_-09')).toBe(true);
	});

	it.each([
		['an empty value', ''],
		['a too short value', 'a'.repeat(31)],
		['a too long value', 'a'.repeat(33)],
		['base64 "+"', 'a'.repeat(31) + '+'],
		['base64 "/"', 'a'.repeat(31) + '/'],
		['a dot', 'a'.repeat(31) + '.'],
		['a non-ASCII letter', 'a'.repeat(31) + 'ä']
	])('rejects %s', (_label, value) => {
		expect(match(value)).toBe(false);
	});
});
