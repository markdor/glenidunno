import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { SCORE_RULES, type SharedBottleView } from '$lib/tasting';
import { FACTS_RULES } from '$lib/tastingFacts';
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
	rules: SCORE_RULES,
	bottle: {
		...fields,
		smoke: 4,
		cask: 3,
		value: 2,
		score: 61.5,
		shares: { smoke: 0.8, cask: 0.6, abv: 0.475, value: 0.4 }
	}
};

const facts: SharedBottleView = {
	tasting,
	presentation: false,
	archived: false,
	algorithm: 'facts',
	position: 2,
	total: 4,
	rules: FACTS_RULES,
	bottle: {
		...fields,
		bottler: null,
		facts: {
			peat: 'none',
			cask: { kind: 'unknown' },
			finish: { kind: 'other', label: 'Tequila', influence: 4, months: null },
			priceCents: null
		},
		score: 41.2,
		shares: { cask: 0.5, abv: 0.3, price: null },
		range: { min: 30.1, max: 60.4 },
		uncertain: true
	}
};

const archived: SharedBottleView = {
	tasting,
	presentation: false,
	archived: true,
	bottle: { ...fields, age: null, whiskybaseUrl: null }
};

describe('SharedBottle', () => {
	test('shows position, score, names, values and factor shares – but no bringer', async () => {
		render(SharedBottle, { view: taste });
		const card = page.getByRole('article', { name: 'Whisky' });
		await expect.element(card).toHaveTextContent('Flasche 3 von 8');
		await expect.element(card).toHaveTextContent(/Score\s*61,5/);
		await expect.element(card).toHaveTextContent(/Destillerie\s*Caol Ila/);
		await expect.element(card).toHaveTextContent(/Abfüllung\s*Sherry Cask/);
		await expect.element(card).toHaveTextContent(/Alter\s*12 Jahre/);
		await expect.element(card).toHaveTextContent(/Abfüller\s*Signatory/);
		await expect.element(card).toHaveTextContent('Rauch 4 · Fass 3 · 54,2 % · Kaliber 2');
		await expect
			.element(card)
			.toHaveTextContent('Rauch 80 % · Fass 60 % · Alkohol 48 % · Kaliber 40 %');
		expect(document.body.textContent).not.toContain('Mitgebracht');
		const link = page.getByRole('link', { name: 'Auf Whiskybase ansehen' });
		await expect.element(link).toHaveAttribute('href', fields.whiskybaseUrl);
		await expect.element(link).toHaveAttribute('rel', 'external noopener noreferrer');
	});

	test('shows the facts, the Wucht with its range and the uncertain order', async () => {
		render(SharedBottle, { view: facts });
		const card = page.getByRole('article', { name: 'Whisky' });
		await expect.element(card).toHaveTextContent('Flasche 2 von 4');
		await expect.element(card).toHaveTextContent(/Wucht\s*~\s*ungefähr\s*41,2/);
		await expect.element(card).toHaveTextContent(/Torf\s*ungetorft/);
		await expect.element(card).toHaveTextContent(/Fass\s*unbekannt/);
		await expect.element(card).toHaveTextContent(/Preis\s*unbekannt/);
		await expect.element(card).toHaveTextContent(/Spanne\s*30,1–60,4 \(Fass unbekannt\)/);
		await expect.element(card).toHaveTextContent('Fass 50 % · Alkohol 30 % · Preis unbekannt');
		await expect.element(card).toHaveTextContent(/Abfüller\s*Originalabfüllung/);
		await expect.element(page.getByText(/Reihenfolge unsicher/)).toBeVisible();
	});

	test('shows a known price share and no uncertainty for a certain bottle', async () => {
		render(SharedBottle, {
			view: {
				...facts,
				bottle: {
					...(facts as Extract<SharedBottleView, { algorithm: 'facts' }>).bottle,
					shares: { cask: 0.5, abv: 0.3, price: 0.25 },
					range: null,
					uncertain: false
				}
			}
		});
		await expect.element(page.getByRole('article')).toHaveTextContent('Preis 25 %');
		await expect.element(page.getByRole('article')).toHaveTextContent(/Wucht\s*41,2/);
		expect(page.getByText(/Reihenfolge unsicher/).elements()).toHaveLength(0);
		expect(page.getByText('Spanne', { exact: true }).elements()).toHaveLength(0);
	});

	test('shows an archived bottle with its ABV only, without position and score', async () => {
		render(SharedBottle, { view: archived });
		const card = page.getByRole('article', { name: 'Whisky' });
		await expect.element(card).toHaveTextContent(/Alkohol\s*54,2 % vol\./);
		await expect.element(card).toHaveTextContent(/Alter\s*NAS/);
		expect(document.body.textContent).not.toMatch(/Flasche \d|Score|Wucht|Faktoren/);
		expect(page.getByRole('link').elements()).toHaveLength(0);
	});
});
