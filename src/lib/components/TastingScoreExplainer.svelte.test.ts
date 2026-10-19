import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { SCORE_RULES } from '$lib/tasting';
import TastingScoreExplainer from './TastingScoreExplainer.svelte';

describe('TastingScoreExplainer', () => {
	test('shows the short summary right away', async () => {
		render(TastingScoreExplainer, { rules: SCORE_RULES });
		await expect
			.element(
				page.getByText(
					/Rauchintensität in drei Gruppen sortiert \(ungetorft → rauchig → stark rauchig\)/
				)
			)
			.toBeVisible();
		// Factors by weight, like the detailed explanation.
		await expect
			.element(
				page.getByText(
					/innerhalb einer Gruppe entscheidet ein Score aus Rauch, Fass, Kaliber und Alkohol\./
				)
			)
			.toBeVisible();
	});

	test('explains each score factor with its share of the score', async () => {
		render(TastingScoreExplainer, { rules: SCORE_RULES });
		await page.getByText('Genauer erklärt').click();

		const factor = (label: string) =>
			page.getByRole('listitem').filter({ hasText: new RegExp(`^\\s*${label}`) });
		for (const [label, weight] of [
			['Rauch', 40],
			['Fass', 30],
			['Kaliber', 20],
			['Alkohol', 10]
		] as const) {
			await expect.element(factor(label)).toHaveTextContent(`${weight} % des Scores`);
		}
		// Sorted by weight, not in the order of the bottle form.
		expect(
			page
				.getByRole('listitem')
				.elements()
				.map((li) => li.querySelector('span')?.textContent)
		).toEqual(['Rauch', 'Fass', 'Kaliber', 'Alkohol']);
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
		render(TastingScoreExplainer, { rules: SCORE_RULES });
		await expect.element(page.getByText('Score = 100 ×', { exact: false })).not.toBeVisible();

		await page.getByText('Genauer erklärt').click();
		await expect.element(page.getByText('Gruppe 1')).toBeVisible();
		await expect.element(page.getByText('ungetorft (Rauch 0)')).toBeVisible();
		await expect.element(page.getByText('rauchig (Rauch 1–3)', { exact: true })).toBeVisible();
		await expect.element(page.getByText('stark rauchig (Rauch 4–5)')).toBeVisible();
		await expect
			.element(
				page.getByText('Score = 100 × (0.4 × Rauch + 0.3 × Fass + 0.2 × Kaliber + 0.1 × Alkohol)')
			)
			.toBeVisible();
		await expect
			.element(
				page.getByText(
					'Bei identischem Score entscheiden der Reihe nach Rauch, Fass, Kaliber, Alkohol und zuletzt der Flaschenname.'
				)
			)
			.toBeVisible();
	});

	test('explains the rules it gets, also the frozen ones of an earlier tasting', async () => {
		render(TastingScoreExplainer, {
			rules: {
				version: 1,
				smokeGroups: [
					{ label: 'mild', range: '0–1' },
					{ label: 'rauchig', range: '2–5' }
				],
				factors: [
					{ key: 'cask', weight: 0.5 },
					{ key: 'smoke', weight: 0.3 },
					{ key: 'value', weight: 0.1 },
					{ key: 'abv', weight: 0.1 }
				],
				scaleMax: 5,
				abv: { floor: 35, kink: 45, ceiling: 60, lowDivisor: 40, highDivisor: 20, kinkShare: 0.25 }
			}
		});

		await expect
			.element(page.getByText(/in zwei Gruppen sortiert \(mild → rauchig\)/))
			.toBeVisible();
		await expect
			.element(page.getByText(/Score aus Fass, Rauch, Kaliber und Alkohol\./))
			.toBeVisible();
		await page.getByText('Genauer erklärt').click();
		await expect.element(page.getByText('mild (Rauch 0–1)')).toBeVisible();
		await expect
			.element(
				page.getByText('Score = 100 × (0.5 × Fass + 0.3 × Rauch + 0.1 × Kaliber + 0.1 × Alkohol)')
			)
			.toBeVisible();
		expect(document.querySelector('pre code')?.textContent).toBe(
			[
				'bis 35:  0',
				'35–45:   (Wert − 35) ÷ 40',
				'45–60:   0.25 + (Wert − 45) ÷ 20',
				'ab 60:   1'
			].join('\n')
		);
	});
});
