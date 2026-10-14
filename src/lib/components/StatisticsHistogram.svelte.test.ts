import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import StatisticsHistogram from './StatisticsHistogram.svelte';

const units = { one: 'Flasche', other: 'Flaschen' };
const columns = [
	{ label: '< 43', count: 1 },
	{ label: '43–45,9', count: 0 },
	{ label: '46–49,9', count: 8 },
	{ label: '≥ 50', count: 4 }
];

function bars() {
	return [...document.querySelectorAll<HTMLElement>('[style*="height"]')].map(
		(bar) => bar.style.height
	);
}

describe('StatisticsHistogram', () => {
	test('labels every column with its count, also for screen readers', async () => {
		render(StatisticsHistogram, { label: 'Flaschen nach Alkoholgehalt', columns, units });
		await expect
			.element(page.getByRole('group', { name: 'Flaschen nach Alkoholgehalt' }))
			.toBeVisible();
		for (const text of ['< 43: 1 Flasche', '43–45,9: 0 Flaschen', '46–49,9: 8 Flaschen']) {
			expect(page.getByText(text, { exact: true }).elements()).toHaveLength(1);
		}
		// Scaled to the largest count; an empty class has no bar.
		expect(bars()).toEqual(['12px', '0px', '96px', '48px']);
	});

	test('sets a column apart and scales it with the others', async () => {
		render(StatisticsHistogram, {
			label: 'Flaschen nach Alter',
			columns,
			extra: { label: 'NAS', count: 16 },
			units
		});
		expect(page.getByText('NAS: 16 Flaschen', { exact: true }).elements()).toHaveLength(1);
		expect(bars()).toEqual(['6px', '0px', '48px', '24px', '96px']);
	});

	test('marks a position on the class axis and keeps its label inside at the edges', async () => {
		const { rerender } = render(StatisticsHistogram, {
			label: 'Flaschen nach Alkoholgehalt',
			columns,
			marker: { position: 2.5, label: 'Ø 47,9 %' },
			units
		});
		const label = page.getByText('Ø 47,9 %');
		await expect.element(label).toHaveStyle({ left: '62.5%' });
		await expect.element(label).toHaveClass('-translate-x-1/2');

		await rerender({ marker: { position: 0.4, label: 'Ø 40,1 %' } });
		await expect.element(page.getByText('Ø 40,1 %')).not.toHaveClass(/translate/);
		await rerender({ marker: { position: 3.9, label: 'Ø 59,0 %' } });
		await expect.element(page.getByText('Ø 59,0 %')).toHaveClass('-translate-x-full');
	});
});
