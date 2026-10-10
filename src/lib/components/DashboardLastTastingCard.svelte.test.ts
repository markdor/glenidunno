import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { DashboardLastTasting } from '$lib/tasting';
import DashboardLastTastingCard from './DashboardLastTastingCard.svelte';

const revealed: DashboardLastTasting = {
	slug: 'sleepy-panda',
	name: 'Sommer-Tasting',
	motto: 'Sherry-Bomben',
	tastingDate: '2026-07-11'
};

/** The line right above the date: the motto, or the name without one. */
function lineAboveDate() {
	return page.getByText('Sa., 11.07.2026', { exact: true }).element().previousElementSibling;
}

describe('DashboardLastTastingCard', () => {
	test('links the last revealed tasting to its reveal with title, motto and date', async () => {
		render(DashboardLastTastingCard, { tasting: revealed });

		const card = page.getByRole('link', { name: /Letztes Tasting/ });
		await expect.element(card).toHaveAttribute('href', '/tasting/sleepy-panda');
		await expect.element(page.getByRole('heading', { name: 'Letztes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Sommer-Tasting')).toBeVisible();
		await expect.element(page.getByText('Sherry-Bomben')).toBeVisible();
		await expect.element(page.getByText('Sa., 11.07.2026', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Zur Auflösung')).toBeVisible();
		expect(lineAboveDate()?.textContent).toBe('Sherry-Bomben');
	});

	test('goes from the name straight to the date without a motto', async () => {
		render(DashboardLastTastingCard, { tasting: { ...revealed, motto: null } });

		await expect.element(page.getByText('Sommer-Tasting')).toBeVisible();
		expect(lineAboveDate()?.textContent).toContain('Sommer-Tasting');
	});

	test('shows neither phase nor progress, the reveal stays on the participant page', async () => {
		render(DashboardLastTastingCard, { tasting: revealed });

		await expect.element(page.getByRole('link')).toBeVisible();
		expect(page.getByText(/Flaschen|Reihenfolge|heute|Aufgelöst/).elements()).toHaveLength(0);
	});

	test('shows a non-clickable empty state without a revealed tasting', async () => {
		const { container } = render(DashboardLastTastingCard, { tasting: null });

		await expect.element(page.getByRole('heading', { name: 'Letztes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		expect(page.getByRole('link').elements()).toHaveLength(0);
		expect(container.querySelector('a, button, [tabindex]')).toBeNull();

		const card = container.firstElementChild as HTMLElement;
		card.focus();
		expect(document.activeElement).not.toBe(card);
	});
});
