import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { formatOneDecimal } from '$lib/tasting';
import StatisticsLineChart from './StatisticsLineChart.svelte';

const format = (value: number) => `${formatOneDecimal(value)} %`;
const HINT = 'Tippe oder fahre mit der Maus über die Linie für die genauen Werte.';

const points = [
	{ date: '2021-05-07', value: 46 },
	{ date: '2022-02-18', value: null },
	{ date: '2022-10-21', value: 55 },
	{ date: '2024-09-27', value: 51.2 }
];

function show(overrides: Record<string, unknown> = {}) {
	return render(StatisticsLineChart, {
		points,
		label: 'Ø Alkohol pro Tasting',
		format,
		unit: '%',
		...overrides
	});
}

function pointer(type: string, clientX: number, pointerType = 'mouse') {
	const layer = document.querySelector('rect[role="presentation"]')!;
	layer.dispatchEvent(new PointerEvent(type, { clientX, clientY: 50, pointerType, bubbles: true }));
}

describe('StatisticsLineChart', () => {
	test('draws a point per value and leaves out the ones without', async () => {
		show();
		await expect.element(page.getByRole('img', { name: 'Ø Alkohol pro Tasting' })).toBeVisible();
		expect(
			page
				.getByRole('button')
				.elements()
				.map((target) => target.getAttribute('aria-label'))
		).toEqual(['07.05.2021: 46,0 %', '21.10.2022: 55,0 %', '27.09.2024: 51,2 %']);
	});

	test('fits the y-axis to the values and marks the years on a time axis', async () => {
		show();
		const texts = [...document.querySelectorAll('svg text')].map((t) => t.textContent?.trim());
		// A non-breaking space between number and unit.
		expect(texts).toEqual(['45 %', '50 %', '55 %', '2022', '2023', '2024']);
	});

	test('keeps a fixed height instead of scaling with the width', async () => {
		show();
		// Server-side rendered at the fallback width: without the height the
		// SVG would scale up to a wide container until hydration.
		const svg = document.querySelector('svg')!;
		expect(svg).toHaveAttribute('height', '182');
		expect(svg.getAttribute('viewBox')).toMatch(/ 182$/);
	});

	test('shows the value of a focused point', async () => {
		show();
		await expect.element(page.getByText(HINT)).toBeVisible();
		(page.getByRole('button', { name: '21.10.2022: 55,0 %' }).element() as SVGElement).focus();
		await expect.element(page.getByText('21.10.2022')).toBeVisible();
		await expect.element(page.getByText('· 55,0 %')).toBeVisible();
	});

	test('picks the point nearest to the pointer, a tap keeps it', async () => {
		show();
		const svg = document.querySelector('svg')!.getBoundingClientRect();
		pointer('pointermove', svg.right - 1);
		await expect.element(page.getByText('· 51,2 %')).toBeVisible();
		pointer('pointerleave', svg.right - 1);
		await expect.element(page.getByText(HINT)).toBeVisible();

		pointer('pointerdown', svg.left + 1, 'touch');
		await expect.element(page.getByText('· 46,0 %')).toBeVisible();
		pointer('pointerleave', svg.left + 1, 'touch');
		await expect.element(page.getByText('· 46,0 %')).toBeVisible();
	});

	test('centers a single point on a padded axis', async () => {
		show({ points: [{ date: '2021-05-07', value: 12 }], unit: null, format: String });
		const texts = [...document.querySelectorAll('svg text')].map((t) => t.textContent?.trim());
		expect(texts).toEqual(['10', '12', '14']);
		expect(page.getByRole('button').elements()).toHaveLength(1);
	});

	test('says so when there is no value at all', async () => {
		show({ points: [{ date: '2021-05-07', value: null }] });
		await expect.element(page.getByText('Keine Werte.')).toBeVisible();
		expect(document.querySelector('svg')).toBeNull();
	});
});
