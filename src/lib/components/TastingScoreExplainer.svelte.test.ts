import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingScoreExplainer from './TastingScoreExplainer.svelte';

describe('TastingScoreExplainer', () => {
	test('shows the short summary right away', async () => {
		render(TastingScoreExplainer);
		await expect.element(page.getByText(/Rauchintensität in drei Gruppen sortiert/)).toBeVisible();
	});

	test('keeps the detailed explanation collapsed until opened', async () => {
		render(TastingScoreExplainer);
		await expect.element(page.getByText('Score = 100 ×', { exact: false })).not.toBeVisible();

		await page.getByText('Genauer erklärt').click();
		await expect.element(page.getByText('Gruppe 1')).toBeVisible();
		await expect.element(page.getByText('Rauch 0–1')).toBeVisible();
		await expect.element(page.getByText('Rauch 4–5')).toBeVisible();
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
