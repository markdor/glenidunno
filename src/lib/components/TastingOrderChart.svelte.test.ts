import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingOrderChart from './TastingOrderChart.svelte';

// Smoke group 1, then group 2: the score drops again at the group change.
const order = [
	{ position: 1, alias: 'Blume', score: 12.5 },
	{ position: 2, alias: 'Heide', score: 38 },
	{ position: 3, alias: 'Nebel', score: 31.2 }
];

describe('TastingOrderChart', () => {
	test('says so when nobody entered a bottle', async () => {
		render(TastingOrderChart, { order: [] });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});

	test('draws exactly one brown score line and nothing per bottle', async () => {
		render(TastingOrderChart, { order });

		await expect.element(page.getByRole('img', { name: /Gesamtscore/ })).toBeVisible();
		const lines = document.querySelectorAll('path[fill="none"]');
		expect(lines).toHaveLength(1);
		expect(lines[0].getAttribute('stroke')).toBe('#7d5212');
		expect(lines[0].getAttribute('d')).not.toMatch(/NaN/);
		// No points, no vertical guides – only the horizontal gridlines remain.
		expect(document.querySelectorAll('circle')).toHaveLength(0);
		const verticals = Array.from(document.querySelectorAll('svg line')).filter(
			(el) => el.getAttribute('x1') === el.getAttribute('x2')
		);
		expect(verticals).toHaveLength(0);
	});

	test('labels only the y-axis: score points without a unit, no aliases', async () => {
		render(TastingOrderChart, { order });

		const texts = Array.from(document.querySelectorAll('svg text')).map((t) =>
			t.textContent?.trim()
		);
		expect(texts).toEqual(['0', '50', '100']);
	});

	test('maps the score onto the 0–100 axis', async () => {
		render(TastingOrderChart, {
			order: [
				{ position: 1, alias: 'Blume', score: 0 },
				{ position: 2, alias: 'Nebel', score: 100 }
			]
		});

		const d = document.querySelector('path[fill="none"]')!.getAttribute('d')!;
		const firstY = d.match(/^M[\d.]+,([\d.]+)/)![1];
		const lastY = d.match(/,([\d.]+)$/)![1];
		const tickY = (label: string) =>
			Array.from(document.querySelectorAll('svg text'))
				.find((t) => t.textContent?.trim() === label)
				?.getAttribute('y');
		expect(firstY).toBe(tickY('0'));
		expect(lastY).toBe(tickY('100'));
	});

	test('reveals no single bottle on hover, tap or focus', async () => {
		const { container } = render(TastingOrderChart, { order });
		const chart = page.getByRole('img', { name: /Gesamtscore/ });
		await expect.element(chart).toBeVisible();

		// Nothing to hover, tap or tab to …
		expect(container.querySelectorAll('[role="button"], [tabindex]')).toHaveLength(0);

		// … and no per-bottle text, neither visible nor as an accessible name.
		const revealed = () =>
			[
				container.textContent ?? '',
				...Array.from(container.querySelectorAll('[aria-label]'), (el) =>
					el.getAttribute('aria-label')
				)
			].join(' ');
		await chart.hover({ position: { x: 200, y: 100 } });
		await chart.click({ position: { x: 200, y: 100 } });
		for (const entry of order) {
			expect(revealed()).not.toContain(entry.alias);
			expect(revealed()).not.toContain(String(entry.score).replace('.', ','));
		}
	});
});
