import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingLineChart, { type ChartSeries } from './TastingLineChart.svelte';

const aliases = ['Blume', 'Nebel', 'Rauch', 'Torf'];

function renderChart(series: ChartSeries[], extra: Record<string, unknown> = {}) {
	return render(TastingLineChart, { aliases, series, ariaLabel: 'Testchart', ...extra });
}

const lines = () => Array.from(document.querySelectorAll('path[fill="none"]'));
const points = () => document.querySelectorAll('circle');
const moves = (d: string | null) => (d ?? '').match(/M/g)?.length ?? 0;

describe('TastingLineChart', () => {
	test('draws one smoothed line and a point per value', async () => {
		renderChart([{ key: 'a', color: '#123456', label: 'A', values: [0, 0.5, 0.75, 1] }]);

		await expect.element(page.getByRole('img', { name: 'Testchart' })).toBeVisible();
		expect(lines()).toHaveLength(1);
		expect(moves(lines()[0].getAttribute('d'))).toBe(1);
		expect(points()).toHaveLength(4);
		await expect.element(page.getByText('A', { exact: true })).toBeVisible();
	});

	test('pauses a line at a gap: two segments, no point there', async () => {
		renderChart([{ key: 'a', color: '#123456', label: 'A', values: [0.2, 0.4, null, 0.6] }]);

		const d = lines()[0].getAttribute('d');
		expect(moves(d)).toBe(2);
		expect(d).not.toMatch(/NaN/);
		expect(points()).toHaveLength(3);
		// The area closes per segment; a single point has none.
		expect(moves(document.querySelector('path[fill-opacity]')!.getAttribute('d'))).toBe(1);
	});

	test('labels a line ending in a gap at its last point, with a leader line', async () => {
		renderChart([{ key: 'a', color: '#123456', label: 'A', values: [0.2, 0.4, null, null] }]);

		const label = page.getByText('A', { exact: true }).element();
		const leader = Array.from(document.querySelectorAll('svg > line')).find((line) =>
			line.classList.contains('stroke-slate-300')
		);
		expect(leader).toBeDefined();
		expect(Number(leader!.getAttribute('x1'))).toBeLessThan(Number(label.getAttribute('x')));
	});

	test('leaves out a line without any value, its label included', async () => {
		renderChart([
			{ key: 'a', color: '#123456', label: 'A', values: [0.2, 0.4, 0.6, 0.8] },
			{ key: 'b', color: '#654321', label: 'B', values: [null, null, null, null] }
		]);

		expect(lines()).toHaveLength(1);
		expect(page.getByText('B', { exact: true }).elements()).toHaveLength(0);
	});

	test('has a target per bottle only with a description', async () => {
		const series = [{ key: 'a', color: '#123456', values: [0.1, 0.2, 0.3, 0.4] }];
		const { unmount } = renderChart(series);
		expect(page.getByRole('button').elements()).toHaveLength(0);
		unmount();

		renderChart(series, { describePoint: (i: number) => `Flasche ${aliases[i]}` });
		expect(page.getByRole('button').elements()).toHaveLength(4);
		await expect.element(page.getByRole('button', { name: 'Flasche Rauch' })).toBeVisible();
	});
});
