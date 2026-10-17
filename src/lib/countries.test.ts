import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES, COUNTRY_SYNONYMS, countryCode, countryName } from './countries';
import { nameKey } from './distilleryNames';

describe('countryCode', () => {
	it('maps the German names, ignoring case and surrounding spaces like nameKey()', () => {
		expect(countryCode('Schweden')).toBe('SE');
		expect(countryCode('schweden')).toBe('SE');
		expect(countryCode('  SCHWEDEN ')).toBe('SE');
		expect(countryCode(nameKey(' Dänemark'))).toBe('DK');
		expect(countryCode('Côte d’Ivoire')).toBe('CI');
	});

	it('maps the parts of the United Kingdom to codes of their own', () => {
		expect(countryCode('Schottland')).toBe('GB-SCT');
		expect(countryCode('England')).toBe('GB-ENG');
		expect(countryCode('Wales')).toBe('GB-WLS');
		expect(countryCode('Nordirland')).toBe('GB-NIR');
	});

	it('maps the synonyms', () => {
		expect(countryCode('USA')).toBe('US');
		expect(countryCode('usa')).toBe('US');
		expect(countryCode('Vereinigte Staaten')).toBe('US');
		expect(countryCode('Vereinigte Staaten von Amerika')).toBe('US');
		expect(countryCode('Tschechische Republik')).toBe('CZ');
	});

	it('has no code for the United Kingdom as a whole and for unknown names', () => {
		expect(countryCode('Vereinigtes Königreich')).toBeNull();
		expect(countryCode('Großbritannien')).toBeNull();
		expect(countryCode('Schotland')).toBeNull();
		expect(countryCode('')).toBeNull();
		// Not an own property: the lookup is a Map, not an object.
		expect(countryCode('constructor')).toBeNull();
	});

	it('only knows synonyms of countries of the list, none of them a name of the list', () => {
		const names = new Set(Object.values(COUNTRY_NAMES).map(nameKey));
		for (const [synonym, code] of Object.entries(COUNTRY_SYNONYMS)) {
			expect(COUNTRY_NAMES[code], synonym).toBeDefined();
			expect(names.has(nameKey(synonym)), synonym).toBe(false);
		}
	});

	it('has distinct names, so every name maps back to its code', () => {
		for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
			expect(countryCode(name), name).toBe(code);
		}
	});
});

describe('countryName', () => {
	it('names a code and nothing else', () => {
		expect(countryName('GB-SCT')).toBe('Schottland');
		expect(countryName('TW')).toBe('Taiwan');
		expect(countryName('GB')).toBeNull();
		expect(countryName('toString')).toBeNull();
	});
});
