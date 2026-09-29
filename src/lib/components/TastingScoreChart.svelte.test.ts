import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingScoreChart from './TastingScoreChart.svelte';

const bottles = [
	{ position: 1, alias: 'Blume', smoke: 0, cask: 1, abv: 40, value: 2 },
	{ position: 2, alias: 'Nebel', smoke: 5, cask: 5, abv: 60, value: 5 }
];

describe('TastingScoreChart', () => {
	test('says so when nobody entered a bottle', async () => {
		render(TastingScoreChart, { bottles: [] });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});

	test('plots every bottle and names every factor', async () => {
		render(TastingScoreChart, { bottles });

		await expect.element(page.getByRole('img')).toBeVisible();
		for (const alias of ['Blume', 'Nebel']) {
			expect(page.getByText(alias, { exact: true }).elements().length).toBeGreaterThan(0);
		}
		for (const label of ['Rauch', 'Fass', 'Alkohol', 'Wertigkeit']) {
			expect(page.getByText(label, { exact: true }).elements().length).toBeGreaterThan(0);
		}
	});

	test('shows the raw values of a bottle on hover and hides them again', async () => {
		render(TastingScoreChart, { bottles });

		await expect.element(page.getByText(/Tippe oder fahre mit der Maus/)).toBeVisible();

		const target = page.getByRole('button', { name: /^Flasche Nebel:/ });
		await target.hover();
		await expect
			.element(page.getByText('· Rauch 5 · Fass 5 · 60,0 % · Wertigkeit 5', { exact: false }))
			.toBeVisible();

		await page.getByRole('img').hover({ position: { x: 5, y: 5 } });
		await expect.element(page.getByText(/Tippe oder fahre mit der Maus/)).toBeVisible();
	});

	test('shows the same values on keyboard focus, for keyboard users', async () => {
		render(TastingScoreChart, { bottles });

		await page
			.getByRole('button', { name: /^Flasche Blume:/ })
			.element()
			.focus();
		await expect
			.element(page.getByText('· Rauch 0 · Fass 1 · 40,0 % · Wertigkeit 2', { exact: false }))
			.toBeVisible();

		(document.activeElement as HTMLElement | null)?.blur();
		await expect.element(page.getByText(/Tippe oder fahre mit der Maus/)).toBeVisible();
	});
});
