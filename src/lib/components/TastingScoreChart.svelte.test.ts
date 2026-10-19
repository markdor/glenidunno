import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { normalizeScoreFactors, type ScoreInput } from '$lib/tasting';
import TastingScoreChart from './TastingScoreChart.svelte';

/** With the shares the current algorithm computes, as the server sends them. */
function withShares<T extends ScoreInput>(bottle: T) {
	return { ...bottle, shares: normalizeScoreFactors(bottle) };
}

const bottles = [
	{ position: 1, alias: 'Blume', smoke: 0, cask: 1, abv: 40, value: 2 },
	{ position: 2, alias: 'Nebel', smoke: 5, cask: 5, abv: 60, value: 5 }
].map(withShares);

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
		for (const label of ['Rauch', 'Fass', 'Alkohol', 'Kaliber']) {
			expect(page.getByText(label, { exact: true }).elements().length).toBeGreaterThan(0);
		}
	});

	test('draws a filled, smoothed area per factor and a guide line per bottle', async () => {
		// Three bottles with a steady, non-reversing trend per factor: the
		// middle point exercises the monotone spline's interior-tangent branch
		// (a two-point chart only ever hits the straight endpoint case).
		const threeBottles = [
			{ position: 1, alias: 'Blume', smoke: 0, cask: 0, abv: 40, value: 0 },
			{ position: 2, alias: 'Nebel', smoke: 2, cask: 2, abv: 50, value: 2 },
			{ position: 3, alias: 'Rauch', smoke: 5, cask: 5, abv: 60, value: 5 }
		].map(withShares);
		render(TastingScoreChart, { bottles: threeBottles });

		const areas = document.querySelectorAll('path[fill-opacity]');
		expect(areas).toHaveLength(4);
		for (const area of areas) {
			const d = area.getAttribute('d');
			expect(d).toMatch(/^M.*C.*C.*Z$/);
			expect(d).not.toMatch(/NaN/);
		}

		const lines = document.querySelectorAll('path[fill="none"]');
		expect(lines).toHaveLength(4);

		const verticalGuides = Array.from(document.querySelectorAll('svg > line')).filter(
			(el) => el.getAttribute('x1') === el.getAttribute('x2')
		);
		expect(verticalGuides).toHaveLength(threeBottles.length);
	});

	test('plots the shares it gets, not ones it computes itself', async () => {
		// The same raw values, but frozen with different shares.
		const frozen = [
			{ position: 1, alias: 'Blume', smoke: 2, cask: 2, abv: 50, value: 2 },
			{ position: 2, alias: 'Nebel', smoke: 2, cask: 2, abv: 50, value: 2 }
		].map((b, i) => ({ ...b, shares: { smoke: i, cask: i, abv: i, value: i } }));
		render(TastingScoreChart, { bottles: frozen });

		// Every line climbs from 0 to 1 instead of staying flat.
		for (const line of document.querySelectorAll('path[fill="none"]')) {
			const ys = [...line.getAttribute('d')!.matchAll(/[\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
			expect(ys[0]).not.toBe(ys.at(-1));
		}
	});

	test('shows the raw values of a bottle on hover and hides them again', async () => {
		render(TastingScoreChart, { bottles });

		await expect.element(page.getByText(/Tippe oder fahre mit der Maus/)).toBeVisible();

		const target = page.getByRole('button', { name: /^Flasche Nebel:/ });
		await target.hover();
		await expect
			.element(page.getByText('· Rauch 5 · Fass 5 · 60,0 % · Kaliber 5', { exact: false }))
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
			.element(page.getByText('· Rauch 0 · Fass 1 · 40,0 % · Kaliber 2', { exact: false }))
			.toBeVisible();

		(document.activeElement as HTMLElement | null)?.blur();
		await expect.element(page.getByText(/Tippe oder fahre mit der Maus/)).toBeVisible();
	});
});
