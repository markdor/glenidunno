import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { BottleFacts } from '$lib/tastingFacts';
import TastingFactsChart from './TastingFactsChart.svelte';

const facts = (overrides: Partial<BottleFacts> = {}): BottleFacts => ({
	peat: 'none',
	cask: { kind: 'known', type: 'bourbon', refill: true },
	finish: { kind: 'none' },
	priceCents: 3500,
	...overrides
});

const bottles = [
	{
		position: 1,
		alias: 'Nebel',
		abv: 40,
		facts: facts(),
		shares: { cask: 0.2, abv: 0, price: 0.19 }
	},
	{
		position: 2,
		alias: 'Bernstein',
		abv: 46,
		facts: facts({
			cask: { kind: 'known', type: 'sherry_oloroso', refill: false },
			finish: { kind: 'known', type: 'sherry_px', refill: false, months: 6 },
			priceCents: null
		}),
		shares: { cask: 0.7, abv: 0.3, price: null }
	},
	{
		position: 3,
		alias: 'Feuer',
		abv: 58,
		facts: facts({ cask: { kind: 'known', type: 'sherry_px', refill: false }, priceCents: 15000 }),
		shares: { cask: 0.9, abv: 0.9, price: 1 }
	}
];

describe('TastingFactsChart', () => {
	test('says so when nobody entered a bottle', async () => {
		render(TastingFactsChart, { bottles: [] });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});

	test('draws cask, ABV and price in the colors of the score chart, labeled', async () => {
		render(TastingFactsChart, { bottles });

		await expect.element(page.getByRole('img', { name: /Fass, Alkohol und Preis/ })).toBeVisible();
		const lines = Array.from(document.querySelectorAll('path[fill="none"]'));
		expect(lines.map((l) => l.getAttribute('stroke'))).toEqual(['#7d3e12', '#ec1337', '#eda100']);
		for (const label of ['Fass', 'Alkohol', 'Preis']) {
			await expect.element(page.getByText(label, { exact: true })).toBeVisible();
		}
	});

	test('leaves a gap in the price line for an unknown price', async () => {
		render(TastingFactsChart, { bottles });

		const price = document.querySelector('path[stroke="#eda100"]')!.getAttribute('d')!;
		expect(price.match(/M/g)).toHaveLength(2);
		expect(price).not.toMatch(/NaN/);
		// Three points for cask and ABV each, two for the price.
		expect(document.querySelectorAll('circle[fill="#eda100"]')).toHaveLength(2);
		expect(document.querySelectorAll('circle[fill="#7d3e12"]')).toHaveLength(3);
	});

	test('names the raw facts of a bottle on focus', async () => {
		render(TastingFactsChart, { bottles });
		await userEvent.hover(page.getByRole('button', { name: /Flasche Bernstein/ }));

		await expect
			.element(
				page.getByText(
					/Sherry Oloroso\/Amontillado \+ Sherry PX, 6 Monate, 46,0 %, Preis unbekannt/
				)
			)
			.toBeVisible();
		await expect
			.element(
				page.getByRole('button', {
					name: /Flasche Nebel: Ex-Bourbon \(Refill\), 40,0 %, Preis 35,00/
				})
			)
			.toBeInTheDocument();
	});
});
