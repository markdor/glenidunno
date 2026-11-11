import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { SharedBottleView } from '$lib/tasting';
import SharedBottle from './SharedBottle.svelte';

const tasting = { name: 'Inselhüpfen', subtitle: 'Tasting #3', tastingDate: '2026-10-24' };
const fields = {
	alias: 'Nebel',
	distillery: 'Caol Ila',
	bottler: 'Signatory',
	bottling: 'Sherry Cask',
	age: 12,
	abv: 54.2,
	whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1'
};

const taste: SharedBottleView = {
	tasting,
	presentation: false,
	archived: false,
	algorithm: 'taste',
	position: 3,
	total: 8,
	bottle: { ...fields, smoke: 4, cask: 3, value: 2 }
};

const facts: SharedBottleView = {
	tasting,
	presentation: false,
	archived: false,
	algorithm: 'facts',
	position: 2,
	total: 4,
	bottle: {
		...fields,
		bottler: null,
		facts: {
			peat: 'none',
			cask: { kind: 'unknown' },
			finish: { kind: 'other', label: 'Tequila', influence: 4, months: null },
			priceCents: null
		}
	}
};

const archived: SharedBottleView = {
	tasting,
	presentation: false,
	archived: true,
	bottle: { ...fields, age: null, whiskybaseUrl: null }
};

/** Nothing about how the order came about – the page leaves it out. */
const ORDER_DETAILS = /Score|Wucht|Faktoren|Spanne|unsicher/;

describe('SharedBottle', () => {
	test('shows position, names and values – but no bringer and no score', async () => {
		render(SharedBottle, { view: taste });
		const card = page.getByRole('article', { name: 'Whisky' });
		await expect.element(card).toHaveTextContent('Flasche 3 von 8');
		await expect.element(card).toHaveTextContent(/Destillerie\s*Caol Ila/);
		await expect.element(card).toHaveTextContent(/Abfüllung\s*Sherry Cask/);
		await expect.element(card).toHaveTextContent(/Alter\s*12 Jahre/);
		await expect.element(card).toHaveTextContent(/Abfüller\s*Signatory/);
		await expect.element(card).toHaveTextContent('Rauch 4 · Fass 3 · 54,2 % · Kaliber 2');
		expect(document.body.textContent).not.toContain('Mitgebracht');
		expect(document.body.textContent).not.toMatch(ORDER_DETAILS);
		const link = page.getByRole('link', { name: 'Auf Whiskybase ansehen' });
		await expect.element(link).toHaveAttribute('href', fields.whiskybaseUrl);
		await expect.element(link).toHaveAttribute('rel', 'external noopener noreferrer');
	});

	test('shows the facts – without Wucht, range or the uncertain order', async () => {
		render(SharedBottle, { view: facts });
		const card = page.getByRole('article', { name: 'Whisky' });
		await expect.element(card).toHaveTextContent('Flasche 2 von 4');
		await expect.element(card).toHaveTextContent(/Torf\s*ungetorft/);
		await expect.element(card).toHaveTextContent(/Fass\s*unbekannt/);
		await expect.element(card).toHaveTextContent(/Nachreifung\s*Tequila/);
		await expect.element(card).toHaveTextContent(/Alkohol\s*54,2 % vol\./);
		await expect.element(card).toHaveTextContent(/Preis\s*unbekannt/);
		await expect.element(card).toHaveTextContent(/Abfüller\s*Originalabfüllung/);
		expect(document.body.textContent).not.toMatch(ORDER_DETAILS);
	});

	test('shows an archived bottle with its ABV only, without position', async () => {
		render(SharedBottle, { view: archived });
		const card = page.getByRole('article', { name: 'Whisky' });
		await expect.element(card).toHaveTextContent(/Alkohol\s*54,2 % vol\./);
		await expect.element(card).toHaveTextContent(/Alter\s*NAS/);
		expect(document.body.textContent).not.toMatch(/Flasche \d/);
		expect(document.body.textContent).not.toMatch(ORDER_DETAILS);
		expect(page.getByRole('link').elements()).toHaveLength(0);
	});
});
