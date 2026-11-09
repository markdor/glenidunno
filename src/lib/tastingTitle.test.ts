import { describe, expect, it } from 'vitest';
import { tastingLabel, tastingSubtitle, tastingTitle } from './tastingTitle';

describe('tastingLabel', () => {
	it('names the running number', () => {
		expect(tastingLabel(1)).toBe('Tasting #1');
		expect(tastingLabel(18)).toBe('Tasting #18');
	});
});

describe('tastingTitle', () => {
	it('is the motto if there is one', () => {
		expect(tastingTitle({ motto: 'Islay gegen den Rest', number: 18 })).toBe(
			'Islay gegen den Rest'
		);
	});

	it('is the running number without a motto', () => {
		expect(tastingTitle({ motto: null, number: 18 })).toBe('Tasting #18');
	});
});

describe('tastingSubtitle', () => {
	it('names the running number below a motto only', () => {
		expect(tastingSubtitle({ motto: 'Islay gegen den Rest', number: 18 })).toBe('Tasting #18');
		expect(tastingSubtitle({ motto: null, number: 18 })).toBeNull();
	});
});
