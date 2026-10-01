import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingScoreExplainer from './TastingScoreExplainer.svelte';

describe('TastingScoreExplainer', () => {
	test('shows the short summary right away', async () => {
		render(TastingScoreExplainer);
		await expect
			.element(
				page.getByText(
					/Rauchintensität in drei Gruppen sortiert \(ungetorft → rauchig → stark rauchig\)/
				)
			)
			.toBeVisible();
	});

	test('explains each score factor with its share of the score', async () => {
		render(TastingScoreExplainer);
		await page.getByText('Genauer erklärt').click();

		const factor = (label: string) =>
			page.getByRole('listitem').filter({ hasText: new RegExp(`^\\s*${label}`) });
		for (const [label, weight] of [
			['Rauch', 40],
			['Fass', 30],
			['Alkohol', 20],
			['Kaliber', 10]
		] as const) {
			await expect.element(factor(label)).toHaveTextContent(`${weight} % des Scores`);
		}
		for (const label of ['Rauch', 'Fass', 'Kaliber']) {
			await expect.element(factor(label)).toHaveTextContent('eigener Wert ÷ 5');
		}
		await expect
			.element(factor('Alkohol'))
			.toHaveTextContent('ab 50 % vol. doppelt so schnell, bis er bei 65 % vol. 1 erreicht');

		await expect.element(page.getByText('(Wert − 40) ÷ 40', { exact: false })).toBeVisible();
		expect(document.querySelector('pre code')?.textContent).toBe(
			[
				'bis 40:  0',
				'40–50:   (Wert − 40) ÷ 40',
				'50–65:   0.25 + (Wert − 50) ÷ 20',
				'ab 65:   1'
			].join('\n')
		);
	});

	test('keeps the detailed explanation collapsed until opened', async () => {
		render(TastingScoreExplainer);
		await expect.element(page.getByText('Score = 100 ×', { exact: false })).not.toBeVisible();

		await page.getByText('Genauer erklärt').click();
		await expect.element(page.getByText('Gruppe 1')).toBeVisible();
		await expect.element(page.getByText('ungetorft (Rauch 0)')).toBeVisible();
		await expect.element(page.getByText('rauchig (Rauch 1–3)', { exact: true })).toBeVisible();
		await expect.element(page.getByText('stark rauchig (Rauch 4–5)')).toBeVisible();
		await expect
			.element(
				page.getByText('Score = 100 × (0.4 × Rauch + 0.3 × Fass + 0.2 × Alkohol + 0.1 × Kaliber)')
			)
			.toBeVisible();
		await expect
			.element(
				page.getByText(
					'Bei identischem Score entscheiden der Reihe nach Rauch, Fass, Alkohol und zuletzt der Flaschenname.'
				)
			)
			.toBeVisible();
	});
});
