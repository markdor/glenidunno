import { describe, it, expect } from 'vitest';
import { match } from '../../params/tastingToken';
import { buildTastingLink, generateTastingToken, hashTastingToken } from './tastingToken';

describe('generateTastingToken', () => {
	it('creates 32 base64url characters (192 bit)', () => {
		const token = generateTastingToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(Buffer.from(token, 'base64url')).toHaveLength(24);
	});

	it('is accepted by the route param matcher', () => {
		for (let i = 0; i < 100; i++) expect(match(generateTastingToken())).toBe(true);
	});

	it('does not collide in a large sample', () => {
		const tokens = new Set(Array.from({ length: 10_000 }, generateTastingToken));
		expect(tokens.size).toBe(10_000);
	});
});

describe('hashTastingToken', () => {
	it('returns the SHA-256 hex digest, never the token itself', () => {
		const token = generateTastingToken();
		const hash = hashTastingToken(token);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toContain(token);
		expect(hashTastingToken(token)).toBe(hash);
	});

	it('matches a known SHA-256 value', () => {
		expect(hashTastingToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});

describe('buildTastingLink', () => {
	it('builds the full participant URL on top of the base URL', () => {
		expect(buildTastingLink('https://glenidunno.markdor.net', 'x'.repeat(32))).toBe(
			`https://glenidunno.markdor.net/tasting/${'x'.repeat(32)}`
		);
	});

	it('ignores a trailing slash on the base URL', () => {
		expect(buildTastingLink('http://localhost:4173/', 'abc')).toBe(
			'http://localhost:4173/tasting/abc'
		);
	});
});
