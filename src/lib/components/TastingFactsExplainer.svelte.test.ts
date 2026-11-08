import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { SCORE_RULES } from '$lib/tasting';
import { FACTS_RULES, type FactsScoreRules } from '$lib/tastingFacts';
import TastingScoreExplainer from './TastingScoreExplainer.svelte';

async function open(rules: FactsScoreRules = FACTS_RULES) {
	render(TastingScoreExplainer, { rules });
	await page.getByText('Genauer erklärt').click();
}

describe('TastingScoreExplainer – facts rules (version 2)', () => {
	test('sums up peat groups and Wucht', async () => {
		render(TastingScoreExplainer, { rules: FACTS_RULES });
		await expect
			.element(
				page.getByText(
					'Die Flaschen werden zuerst nach Torf in drei Gruppen sortiert (ungetorft → leicht getorft → stark getorft), innerhalb einer Gruppe entscheidet die Wucht aus Fass, Alkohol und Preis – alles Angaben von Etikett und Shop.'
				)
			)
			.toBeVisible();
		// Not the taste tile.
		expect(page.getByText(/Rauchintensität/).elements()).toHaveLength(0);
	});

	test('explains every factor with the numbers of the rules', async () => {
		await open();

		await expect.element(page.getByText('Gruppe 3')).toBeVisible();
		await expect.element(page.getByText('50 % der Wucht')).toBeVisible();
		await expect.element(page.getByText('30 % der Wucht')).toBeVisible();
		await expect.element(page.getByText('20 % der Wucht')).toBeVisible();
		await expect
			.element(page.getByText('Wucht = 100 × (0,5 × Fass + 0,3 × Alkohol + 0,2 × Preis)'))
			.toBeVisible();
		await expect.element(page.getByText(/„Refill“ zählt es 2 weniger/)).toBeVisible();
		await expect
			.element(page.getByText(/Die Nachreifung zählt ihren Wert × 0,5, voll ab 12 Monaten/))
			.toBeVisible();
		await expect.element(page.getByText(/von 0 bei 40 % vol. bis 1 bei 60 % vol./)).toBeVisible();
		await expect.element(page.getByText(/von 0 bei 25 € bis 1 bei 150 €/)).toBeVisible();
		await expect
			.element(
				page.getByText(
					'Bei identischer Wucht entscheiden der Reihe nach Alkohol, Preis (unbekannt zuletzt), zuletzt der Flaschenname.'
				)
			)
			.toBeVisible();
		await expect
			.element(
				page.getByText(
					/für die Hauptreifung jeder Wert von 2 bis 9, für die Nachreifung von 0 bis 4,5/
				)
			)
			.toBeVisible();
	});

	test('lists the cask table with the typical and the refill value', async () => {
		await open();
		const row = (label: string) =>
			Array.from(document.querySelectorAll('tbody tr')).find(
				(tr) => tr.firstElementChild?.textContent === label
			)!;
		expect(row('Sherry PX').textContent).toMatch(/Sherry PX\s*9\s*7/);
		expect(row('Virgin Oak').textContent).toMatch(/Virgin Oak\s*7\s*–/);
		expect(document.querySelectorAll('tbody tr')).toHaveLength(FACTS_RULES.cask.types.length);
	});

	test('explains frozen rules, not the current ones', async () => {
		await open({
			...FACTS_RULES,
			factors: [
				{ key: 'abv', weight: 0.6 },
				{ key: 'cask', weight: 0.25 },
				{ key: 'price', weight: 0.15 }
			],
			cask: { ...FACTS_RULES.cask, refillPenalty: 3, finishFullMonths: 24 },
			tieBreakers: ['price', 'abv']
		});
		await expect
			.element(page.getByText('Wucht = 100 × (0,6 × Alkohol + 0,25 × Fass + 0,15 × Preis)'))
			.toBeVisible();
		await expect.element(page.getByText(/zählt es 3 weniger/)).toBeVisible();
		await expect.element(page.getByText(/voll ab 24 Monaten/)).toBeVisible();
		await expect
			.element(page.getByText(/Preis \(unbekannt zuletzt\), Alkohol, zuletzt/))
			.toBeVisible();
	});

	test('skips the groups section for an order poured without them', async () => {
		await open({ ...FACTS_RULES, peatGroups: [] });
		await expect
			.element(page.getByText(/Die Flaschen werden aufsteigend nach der Wucht/))
			.toBeVisible();
		expect(page.getByText('1. Torfgruppen').elements()).toHaveLength(0);
		await expect.element(page.getByText('1. Wucht', { exact: true })).toBeVisible();
	});

	test('still renders the taste tile for version 1', async () => {
		render(TastingScoreExplainer, { rules: SCORE_RULES });
		await expect.element(page.getByText(/nach Rauchintensität/)).toBeVisible();
	});
});
