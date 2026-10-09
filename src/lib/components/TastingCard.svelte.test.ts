import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingCard from './TastingCard.svelte';

const today = {
	id: 't1',
	name: 'Herbst-Tasting',
	tastingDate: '2026-10-24',
	phase: 'entry' as const,
	progress: { entered: 5, total: 6 },
	isToday: true
};

const later = {
	id: 't2',
	name: 'Winter-Tasting',
	tastingDate: '2026-12-12',
	phase: 'entry' as const,
	progress: { entered: 0, total: 4 },
	isToday: false
};

describe('TastingCard', () => {
	test('links to the tasting admin as a whole', async () => {
		render(TastingCard, { summary: { upcomingCount: 2, preview: [today, later] } });

		const card = page.getByRole('link', { name: /Tasting-Verwaltung/ });
		await expect.element(card).toHaveAttribute('href', '/admin/tastings');
		await expect.element(page.getByText('2 anstehend')).toBeVisible();
	});

	test('previews name, date, today marker and entry progress', async () => {
		render(TastingCard, { summary: { upcomingCount: 2, preview: [today, later] } });

		await expect.element(page.getByText('Herbst-Tasting')).toBeVisible();
		await expect.element(page.getByText('heute')).toBeVisible();
		await expect.element(page.getByText(/Sa\., 24\.10\.2026 · 5\/6 Flaschen/)).toBeVisible();
		await expect.element(page.getByText(/Sa\., 12\.12\.2026 · 0\/4 Flaschen/)).toBeVisible();
		expect(page.getByText('heute').elements()).toHaveLength(1);
	});

	test('shows no progress once the entry phase is over', async () => {
		render(TastingCard, {
			summary: { upcomingCount: 1, preview: [{ ...today, phase: 'order' }] }
		});
		await expect.element(page.getByText('Sa., 24.10.2026')).toBeVisible();
		expect(page.getByText(/Flaschen/).elements()).toHaveLength(0);
	});

	test('says so when no tasting is planned', async () => {
		render(TastingCard, { summary: { upcomingCount: 0, preview: [] } });
		await expect.element(page.getByText('0 anstehend')).toBeVisible();
		await expect.element(page.getByText('Kein Tasting geplant.')).toBeVisible();
	});
});
