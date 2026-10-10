import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { DashboardTasting } from '$lib/tasting';
import DashboardTastingCard from './DashboardTastingCard.svelte';

const upcoming: DashboardTasting = {
	slug: 'fluffy-otter',
	name: 'Herbst-Tasting',
	motto: 'Islay gegen den Rest',
	tastingDate: '2026-10-24',
	phase: 'entry',
	isToday: true,
	progress: { entered: 1, total: 2 }
};

/** The line right above the date: the motto, or the name without one. */
function lineAboveDate() {
	return page.getByText('Sa., 24.10.2026', { exact: true }).element().previousElementSibling;
}

describe('DashboardTastingCard', () => {
	test('links the next tasting with motto, deadline and own progress during entry', async () => {
		render(DashboardTastingCard, { tasting: upcoming });

		const card = page.getByRole('link', { name: /Nächstes Tasting/ });
		await expect.element(card).toHaveAttribute('href', '/tasting/fluffy-otter');
		await expect.element(page.getByRole('heading', { name: 'Nächstes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Herbst-Tasting')).toBeVisible();
		await expect.element(page.getByText('heute', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Islay gegen den Rest')).toBeVisible();
		await expect.element(page.getByText('Sa., 24.10.2026', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Flaschen eintragen bis heute, 18 Uhr')).toBeVisible();
		await expect.element(page.getByText('1 von 2 Flaschen eingetragen')).toBeVisible();
		await expect.element(page.getByText('Zum Tasting')).toBeVisible();
		// Name, then the motto on its own line, then the date.
		expect(lineAboveDate()?.textContent).toBe('Islay gegen den Rest');
		// The deadline doesn't repeat the date of the line above.
		expect(page.getByText(/24\.10\.2026/).elements()).toHaveLength(1);
	});

	test('goes from the name straight to the date without a motto', async () => {
		render(DashboardTastingCard, { tasting: { ...upcoming, motto: null } });

		await expect.element(page.getByText('Herbst-Tasting')).toBeVisible();
		expect(lineAboveDate()?.textContent).toContain('Herbst-Tasting');
	});

	test('names the deadline relative to the tasting day before it', async () => {
		render(DashboardTastingCard, { tasting: { ...upcoming, isToday: false } });

		await expect
			.element(page.getByText('Flaschen eintragen bis 18 Uhr am Tasting-Tag'))
			.toBeVisible();
		expect(page.getByText('heute').elements()).toHaveLength(0);
		expect(page.getByText(/24\.10\.2026/).elements()).toHaveLength(1);
	});

	test('says the order is out, without progress', async () => {
		render(DashboardTastingCard, { tasting: { ...upcoming, phase: 'order', isToday: false } });

		await expect.element(page.getByRole('heading', { name: 'Nächstes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Die Reihenfolge steht')).toBeVisible();
		await expect.element(page.getByText('Zum Tasting')).toBeVisible();
		expect(page.getByText(/Flaschen/).elements()).toHaveLength(0);
		expect(page.getByText('heute').elements()).toHaveLength(0);
	});

	test('shows a non-clickable empty state without a tasting', async () => {
		const { container } = render(DashboardTastingCard, { tasting: null });

		await expect.element(page.getByRole('heading', { name: 'Nächstes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Kein Tasting geplant.')).toBeVisible();
		expect(page.getByRole('link').elements()).toHaveLength(0);
		expect(container.querySelector('a, button, [tabindex]')).toBeNull();
	});
});
