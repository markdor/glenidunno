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

/** ABV intervals of 1 %-point from 40 to 67, bounds labelled, 46 the anchor. */
const ABV_COUNTS = [
	1, 0, 1, 6, 0, 3, 28, 3, 10, 2, 15, 1, 2, 3, 7, 3, 2, 3, 8, 2, 3, 1, 0, 1, 1, 0, 1
];
const ABV = {
	label: 'Flaschen nach Alkoholgehalt',
	columns: ABV_COUNTS.map((count, i) => ({
		label: '',
		count,
		description: `${40 + i}–${40 + i},9 % vol.`
	})),
	bounds: Array.from({ length: ABV_COUNTS.length + 1 }, (_, i) => String(40 + i)),
	anchor: 6,
	fill: true,
	units
};

function bars() {
	return [...document.querySelectorAll<HTMLElement>('[style*="height"]')].map(
		(bar) => bar.style.height
	);
}

/** The axis labels shown, thinned-out ones left out. */
function axisLabels() {
	return [...document.querySelectorAll('.text-\\[11px\\]')]
		.map((label) => label.textContent?.trim())
		.filter(Boolean);
}

/** The counts shown on top of the bars. */
function counts() {
	return [...document.querySelectorAll('span.tabular-nums.text-xs:not(.invisible)')].map((count) =>
		count.textContent?.trim()
	);
}

/** Renders at a given plot width: the chart measures its container. */
async function showAt(width: number, props: Record<string, unknown>) {
	// Under `props`: `anchor` is also an option of Svelte's mount().
	const result = render(StatisticsHistogram, { props: props as never });
	result.container.style.width = `${width}px`;
	// One frame for the ResizeObserver behind bind:clientWidth.
	await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
	return result;
}

describe('StatisticsHistogram', () => {
	test('describes every column with its count, but draws neither bar nor 0 for an empty one', async () => {
		render(StatisticsHistogram, { label: 'Flaschen nach Alkoholgehalt', columns, units });
		await expect
			.element(page.getByRole('group', { name: 'Flaschen nach Alkoholgehalt' }))
			.toBeVisible();
		for (const text of ['< 43: 1 Flasche', '43–45,9: 0 Flaschen', '46–49,9: 8 Flaschen']) {
			expect(page.getByText(text, { exact: true }).elements()).toHaveLength(1);
		}
		// Scaled to the largest count; an empty class has no bar.
		expect(bars()).toEqual(['12px', '96px', '48px']);
		expect(counts()).toEqual(['1', '8', '4']);
		expect(axisLabels()).toEqual(['< 43', '43–45,9', '46–49,9', '≥ 50']);
	});

	test('sets a column apart behind a dashed line and scales it with the others', async () => {
		render(StatisticsHistogram, {
			label: 'Flaschen nach Alter',
			columns,
			extra: { label: 'NAS', count: 16 },
			units
		});
		expect(page.getByText('NAS: 16 Flaschen', { exact: true }).elements()).toHaveLength(1);
		expect(bars()).toEqual(['6px', '48px', '24px', '96px']);
		const nas = document.querySelector('.bg-slate-400')!.closest('ul');
		expect(nas).toHaveClass('border-l', 'border-dashed');
	});

	test('marks a position as a dashed line and keeps its label inside at the edges', async () => {
		const { rerender } = render(StatisticsHistogram, {
			label: 'Flaschen nach Alkoholgehalt',
			columns,
			marker: { position: 2.5, label: 'Ø 47,9 %' },
			units
		});
		const label = page.getByText('Ø 47,9 %');
		await expect.element(label).toHaveStyle({ left: '62.5%' });
		await expect.element(label).toHaveClass('-translate-x-1/2');
		const line = document.querySelector('.border-dashed')!;
		expect(line).toHaveStyle({ left: '62.5%' });
		expect(line).toHaveClass('border-l');

		await rerender({ marker: { position: 0.4, label: 'Ø 40,1 %' } });
		await expect.element(page.getByText('Ø 40,1 %')).not.toHaveClass(/translate/);
		await rerender({ marker: { position: 3.9, label: 'Ø 59,0 %' } });
		await expect.element(page.getByText('Ø 59,0 %')).toHaveClass('-translate-x-full');
	});

	test('says when there is nothing to show', async () => {
		render(StatisticsHistogram, { label: 'Flaschen nach Alter', columns: [], units });
		await expect.element(page.getByText('Keine Werte.')).toBeVisible();
		expect(page.getByRole('group').elements()).toHaveLength(0);
	});
});

describe('StatisticsHistogram – room on the axis', () => {
	test('labels every bound while there is room', async () => {
		await showAt(27 * 30, ABV);
		expect(axisLabels()).toEqual(ABV.bounds);
		// Every count fits.
		expect(counts()).toHaveLength(ABV_COUNTS.filter((count) => count > 0).length);
	});

	test('labels every other bound on a desktop, the anchor among them', async () => {
		await showAt(27 * 26, ABV);
		expect(axisLabels()).toEqual(ABV.bounds.filter((_, i) => i % 2 === 0));
		expect(axisLabels()).toContain('46');
	});

	test('thins out labels and counts on a phone, but keeps the anchor and the highest bars', async () => {
		await showAt(27 * 8, ABV);
		expect(axisLabels()).toEqual(['42', '46', '50', '54', '58', '62', '66']);
		const shown = counts();
		expect(shown).toContain('28');
		expect(shown).toContain('15');
		// Neighbours at about the same height collide: the higher count stays.
		expect(shown.length).toBeLessThan(ABV_COUNTS.filter((count) => count > 0).length);
		// Every count is still there for screen readers.
		expect(page.getByText('52–52,9 % vol.: 2 Flaschen', { exact: true }).elements()).toHaveLength(
			1
		);
	});

	test('thins out labels below the columns from the anchor on', async () => {
		const ages = Array.from({ length: 22 }, (_, i) => ({ label: String(3 + i), count: 1 }));
		await showAt(22 * 20, { label: 'Flaschen nach Alter', columns: ages, fill: true, units });
		expect(axisLabels()).toEqual(['3', '5', '7', '9', '11', '13', '15', '17', '19', '21', '23']);
	});

	test('shows a hidden count on tap and keeps it until the next one', async () => {
		const tight = [27, 28, 26, 25].map((count, i) => ({ label: String(i), count }));
		const { container } = await showAt(44, { label: 'Dicht', columns: tight, fill: true, units });
		expect(counts()).toEqual(['28', '25']);

		const plot = container.querySelector('ul')!;
		const box = plot.getBoundingClientRect();
		const at = (column: number) => box.left + (column + 0.5) * (box.width / 4);
		const pointer = (type: string, column: number, pointerType = 'touch') =>
			plot.dispatchEvent(
				new PointerEvent(type, { clientX: at(column), pointerType, bubbles: true })
			);

		pointer('pointerdown', 0);
		pointer('pointerleave', 0);
		await expect.poll(counts).toEqual(['27', '28', '25']);
		await expect.element(page.getByText('27', { exact: true })).toHaveClass('bg-white');

		pointer('pointerdown', 2);
		await expect.poll(counts).toEqual(['28', '26', '25']);

		// Hover with the mouse shows the count only while over the bar.
		pointer('pointermove', 0, 'mouse');
		await expect.poll(counts).toEqual(['27', '28', '25']);
		pointer('pointerleave', 0, 'mouse');
		await expect.poll(counts).toEqual(['28', '25']);
	});
});
