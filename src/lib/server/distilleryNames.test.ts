import { describe, it, expect } from 'vitest';
import {
	groupByName,
	isPlaceholderDistillery,
	nameKey,
	PLACEHOLDER_DISTILLERIES
} from './distilleryNames';

describe('nameKey', () => {
	it('ignores case and surrounding whitespace, also beyond ASCII', () => {
		expect(nameKey('  Ardbeg ')).toBe('ardbeg');
		expect(nameKey('ÄRDBEG')).toBe(nameKey('ärdbeg'));
	});

	it('keeps spelling variants apart', () => {
		expect(nameKey('Bruichladdich')).not.toBe(nameKey('Bruichladdich Distillery'));
	});
});

describe('isPlaceholderDistillery', () => {
	it('knows Blend and Unbekannt in any case', () => {
		expect([...PLACEHOLDER_DISTILLERIES]).toEqual(['blend', 'unbekannt']);
		expect(isPlaceholderDistillery('Blend')).toBe(true);
		expect(isPlaceholderDistillery(' UNBEKANNT ')).toBe(true);
		expect(isPlaceholderDistillery('Blended Malt')).toBe(false);
	});
});

describe('groupByName', () => {
	it('counts per key and shows the first spelling', () => {
		expect(groupByName(['ardbeg ', 'Lagavulin', 'Ardbeg', 'ARDBEG'])).toEqual([
			{ name: 'ardbeg', count: 3 },
			{ name: 'Lagavulin', count: 1 }
		]);
	});
});
