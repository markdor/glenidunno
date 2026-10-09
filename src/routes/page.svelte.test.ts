import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { DashboardTasting } from '$lib/tasting';
import Page from './+page.svelte';

const user = { id: '1', username: 'maxi', isAdmin: false };
const admin = { id: '2', username: 'admin', isAdmin: true };

const heroTasting: DashboardTasting = {
	slug: 'fluffy-otter',
	name: 'Herbst-Tasting',
	tastingDate: '2026-10-24',
	phase: 'entry',
	isToday: true,
	progress: { entered: 1, total: 2 }
};
const emptySummary = { upcomingCount: 0, preview: [] };

const COMING_SOON = ['Abgeschlossene Tastings', 'Historie', 'Statistiken'];

function hrefs() {
	return page
		.getByRole('link')
		.elements()
		.map((link) => link.getAttribute('href'));
}

describe('Start page', () => {
	test('greets the logged-in user', async () => {
		render(Page, { data: { user, heroTasting: null, tastingSummary: null } });
		await expect.element(page.getByRole('heading', { name: /Hallo maxi/ })).toBeVisible();
	});

	test('links the own tasting in the hero', async () => {
		render(Page, { data: { user, heroTasting, tastingSummary: null } });
		await expect
			.element(page.getByRole('link', { name: /Kommendes Tasting/ }))
			.toHaveAttribute('href', '/tasting/fluffy-otter');
	});

	test('shows the empty state without an own tasting', async () => {
		render(Page, { data: { user, heroTasting: null, tastingSummary: null } });
		await expect.element(page.getByText('Kein Tasting geplant.')).toBeVisible();
		expect(hrefs()).toEqual([]);
	});

	test('shows everybody the sections still to come, without a link', async () => {
		render(Page, { data: { user, heroTasting, tastingSummary: null } });
		for (const title of COMING_SOON) {
			await expect.element(page.getByText(title, { exact: true })).toBeVisible();
		}
		expect(page.getByText('Demnächst').elements()).toHaveLength(COMING_SOON.length);
		// The hero is the only link for non-admins: no admin card, no "Neues Tasting".
		expect(hrefs()).toEqual(['/tasting/fluffy-otter']);
		expect(page.getByText('Neues Tasting').elements()).toHaveLength(0);
		expect(page.getByText('Tasting-Verwaltung').elements()).toHaveLength(0);
	});

	test('shows the admin hero, admin card and "Neues Tasting" in this order', async () => {
		render(Page, { data: { user: admin, heroTasting, tastingSummary: emptySummary } });
		await expect.element(page.getByRole('link', { name: /Tasting-Verwaltung/ })).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Neues Tasting' }))
			.toHaveAttribute('href', '/admin/tastings/new');
		expect(hrefs()).toEqual(['/tasting/fluffy-otter', '/admin/tastings', '/admin/tastings/new']);
		expect(page.getByText('Demnächst').elements()).toHaveLength(COMING_SOON.length);
	});

	test('shows the admin card even if the admin takes part in no tasting', async () => {
		render(Page, { data: { user: admin, heroTasting: null, tastingSummary: emptySummary } });
		await expect.element(page.getByRole('link', { name: /Tasting-Verwaltung/ })).toBeVisible();
		expect(hrefs()).toEqual(['/admin/tastings', '/admin/tastings/new']);
	});
});
