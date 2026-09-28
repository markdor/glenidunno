import { describe, it, expect } from 'vitest';
import {
	fileNameKey,
	presentationBaseName,
	presentationExtension,
	PRESENTATION_FILE_RE,
	uniquePresentationFileName
} from './presentationFiles';

describe('presentationBaseName', () => {
	it.each([
		['Nebel', 'Tasting_2026-10-24_Nebel'],
		['Ölfass', 'Tasting_2026-10-24_Ölfass'],
		['Nebel am Meer', 'Tasting_2026-10-24_Nebel_am_Meer'],
		['Torf-Monster_2', 'Tasting_2026-10-24_Torf-Monster_2'],
		// No path separators, dots or other specials survive.
		['../../etc/passwd', 'Tasting_2026-10-24_etc_passwd'],
		['Nr. 7 (rauchig)!', 'Tasting_2026-10-24_Nr_7_rauchig'],
		['!!!', 'Tasting_2026-10-24_Flasche']
	])('names the alias %j as %s', (alias, expected) => {
		expect(presentationBaseName('2026-10-24', alias)).toBe(expected);
	});

	it('always matches the pattern checked before disk access', () => {
		for (const alias of ['Nebel', '../x', 'Ä Ö Ü ß', '😀']) {
			expect(PRESENTATION_FILE_RE.test(`${presentationBaseName('2026-10-24', alias)}.pptx`)).toBe(
				true
			);
		}
	});
});

describe('presentationExtension', () => {
	it.each([
		['Deck.PPTX', '.pptx'],
		['archive.tar.gz', '.gz'],
		['Tasting_2026-10-24_Nebel.pdf', '.pdf'],
		['no-extension', ''],
		['.hidden', ''],
		['odd.p$x', ''],
		['long.abcdefghijk', '']
	])('takes %j as %j', (name, expected) => {
		expect(presentationExtension(name)).toBe(expected);
	});
});

describe('uniquePresentationFileName', () => {
	const base = 'Tasting_2026-10-24_Nebel';

	it('uses the plain name while it is free', () => {
		expect(uniquePresentationFileName(base, '.pptx', new Set())).toBe(`${base}.pptx`);
	});

	it('counts up while names are taken, ignoring case', () => {
		const taken = new Set([
			fileNameKey(`${base.toUpperCase()}.PPTX`),
			fileNameKey(`${base}_2.pptx`)
		]);
		expect(uniquePresentationFileName(base, '.pptx', taken)).toBe(`${base}_3.pptx`);
	});

	it('treats different extensions as different files', () => {
		expect(uniquePresentationFileName(base, '.pdf', new Set([fileNameKey(`${base}.pptx`)]))).toBe(
			`${base}.pdf`
		);
	});
});
