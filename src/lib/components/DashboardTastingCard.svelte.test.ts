import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { DashboardTasting } from '$lib/tasting';
import DashboardTastingCard from './DashboardTastingCard.svelte';

const upcoming: DashboardTasting = {
	slug: 'fluffy-otter',
	name: 'Herbst-Tasting',
	tastingDate: '2026-10-24',
	phase: 'entry',
	isToday: true,
	progress: { entered: 1, total: 2 }
};

describe('DashboardTastingCard', () => {
	test('links the upcoming tasting with deadline and own progress during entry', async () => {
		render(DashboardTastingCard, { tasting: upcoming });

		const card = page.getByRole('link', { name: /Kommendes Tasting/ });
		await expect.element(card).toHaveAttribute('href', '/tasting/fluffy-otter');
		await expect.element(page.getByRole('heading', { name: 'Kommendes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Herbst-Tasting')).toBeVisible();
		await expect.element(page.getByText('heute')).toBeVisible();
		await expect.element(page.getByText('Sa., 24.10.2026', { exact: true })).toBeVisible();
		await expect
			.element(page.getByText('Flaschen eintragen bis Sa., 24.10.2026, 18 Uhr'))
			.toBeVisible();
		await expect.element(page.getByText('1 von 2 Flaschen eingetragen')).toBeVisible();
		await expect.element(page.getByText('Zum Tasting')).toBeVisible();
	});

	test('says the order is out, without progress', async () => {
		render(DashboardTastingCard, { tasting: { ...upcoming, phase: 'order', isToday: false } });

		await expect.element(page.getByRole('heading', { name: 'Kommendes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Die Reihenfolge steht')).toBeVisible();
		expect(page.getByText(/Flaschen/).elements()).toHaveLength(0);
		expect(page.getByText('heute').elements()).toHaveLength(0);
	});

	test('links the last revealed tasting to its reveal', async () => {
		render(DashboardTastingCard, { tasting: { ...upcoming, phase: 'revealed', isToday: false } });

		const card = page.getByRole('link', { name: /Letztes Tasting/ });
		await expect.element(card).toHaveAttribute('href', '/tasting/fluffy-otter');
		await expect.element(page.getByText('Aufgelöst')).toBeVisible();
		await expect.element(page.getByText('Zur Auflösung')).toBeVisible();
		expect(page.getByText(/Flaschen/).elements()).toHaveLength(0);
	});

	test('shows a non-clickable empty state without a tasting', async () => {
		render(DashboardTastingCard, { tasting: null });

		await expect.element(page.getByRole('heading', { name: 'Kommendes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Kein Tasting geplant.')).toBeVisible();
		expect(page.getByRole('link').elements()).toHaveLength(0);
	});
});
