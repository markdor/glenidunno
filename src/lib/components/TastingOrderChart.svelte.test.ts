import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingOrderChart from './TastingOrderChart.svelte';

const order = [
	{ position: 1, alias: 'Blume' },
	{ position: 2, alias: 'Nebel' },
	{ position: 3, alias: 'Torf' }
];
const curves = [
	[0, 0.4, 1],
	[0.1, 0.3, 0.6],
	[0.2, 0.6, 0.8],
	[0.8, 0.8, 1]
];

describe('TastingOrderChart', () => {
	test('says so when nobody entered a bottle', async () => {
		render(TastingOrderChart, { order: [], curves: [[], [], [], []] });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
		expect(document.querySelector('svg[role="img"]')).toBeNull();
	});

	test('plots one smoothed line per curve over the pouring order', async () => {
		render(TastingOrderChart, { order, curves });

		await expect.element(page.getByRole('img')).toBeVisible();
		for (const { alias } of order) {
			expect(page.getByText(alias, { exact: true }).elements().length).toBeGreaterThan(0);
		}
		const lines = document.querySelectorAll('path[fill="none"]');
		expect(lines).toHaveLength(curves.length);
		for (const line of lines) {
			expect(line.getAttribute('d')).toMatch(/^M.*C.*C/);
		}
		expect(document.querySelectorAll('circle')).toHaveLength(curves.length * order.length);
	});

	test('draws every line in the same brown, so no line stands out', async () => {
		render(TastingOrderChart, { order, curves });

		await expect.element(page.getByRole('img')).toBeVisible();
		const attr = (selector: string, name: string) =>
			Array.from(document.querySelectorAll(selector), (el) => el.getAttribute(name));
		const colors = new Set([
			...attr('path[fill="none"]', 'stroke'),
			...attr('path[fill-opacity]', 'fill'),
			...attr('circle', 'fill')
		]);
		expect([...colors]).toEqual(['#7d5212']);
	});

	test('names no factor on a line and reveals no values on hover or focus', async () => {
		render(TastingOrderChart, { order, curves });

		await expect.element(page.getByRole('img')).toBeVisible();
		const svgText = document.querySelector('svg')!.textContent!;
		for (const label of ['Rauch', 'Fass', 'Alkohol', 'Kaliber']) {
			expect(svgText).not.toContain(label);
		}
		expect(page.getByRole('button').elements()).toHaveLength(0);
		expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);
	});
});
