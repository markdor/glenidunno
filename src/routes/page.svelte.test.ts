import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { DashboardLastTasting, DashboardTasting } from '$lib/tasting';
import Page from './+page.svelte';

const user = { id: '1', username: 'maxi', isAdmin: false };
const admin = { id: '2', username: 'admin', isAdmin: true };

const nextTasting: DashboardTasting = {
	slug: 'fluffy-otter',
	name: 'Herbst-Tasting',
	motto: 'Islay gegen den Rest',
	tastingDate: '2026-10-24',
	phase: 'entry',
	isToday: true,
	progress: { entered: 1, total: 2 }
};
const lastTasting: DashboardLastTasting = {
	slug: 'sleepy-panda',
	name: 'Sommer-Tasting',
	motto: null,
	tastingDate: '2026-07-11'
};
const noTastings = { nextTasting: null, lastTasting: null };
const bothTastings = { nextTasting, lastTasting };
const emptySummary = { upcomingCount: 0, preview: [] };

const COMING_SOON = ['Historie', 'Statistiken'];

function hrefs() {
	return page
		.getByRole('link')
		.elements()
		.map((link) => link.getAttribute('href'));
}

/** Fails unless the elements stand in this order in the document. */
function expectInOrder(...elements: Element[]) {
	for (let i = 1; i < elements.length; i++) {
		const position = elements[i - 1].compareDocumentPosition(elements[i]);
		expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	}
}

function heading(name: string) {
	return page.getByRole('heading', { name }).element();
}

describe('Start page', () => {
	test('greets the logged-in user', async () => {
		render(Page, { data: { user, ...noTastings, tastingSummary: null } });
		await expect.element(page.getByRole('heading', { name: /Hallo maxi/ })).toBeVisible();
	});

	test('links the next and the last own tasting to the participant page', async () => {
		render(Page, { data: { user, ...bothTastings, tastingSummary: null } });
		await expect
			.element(page.getByRole('link', { name: /Nächstes Tasting/ }))
			.toHaveAttribute('href', '/tasting/fluffy-otter');
		await expect
			.element(page.getByRole('link', { name: /Letztes Tasting/ }))
			.toHaveAttribute('href', '/tasting/sleepy-panda');
	});

	test('shows both cards in their empty state without an own tasting', async () => {
		render(Page, { data: { user, ...noTastings, tastingSummary: null } });
		await expect.element(page.getByText('Kein Tasting geplant.')).toBeVisible();
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		expect(hrefs()).toEqual([]);
	});

	test('shows everybody the sections still to come, without a link', async () => {
		render(Page, { data: { user, ...bothTastings, tastingSummary: null } });
		for (const title of COMING_SOON) {
			await expect.element(page.getByText(title, { exact: true })).toBeVisible();
		}
		expect(page.getByText('Demnächst').elements()).toHaveLength(COMING_SOON.length);
		// The two cards are the only links for non-admins: no admin card, no tiles.
		expect(hrefs()).toEqual(['/tasting/fluffy-otter', '/tasting/sleepy-panda']);
		expect(page.getByText('Tasting-Verwaltung').elements()).toHaveLength(0);
		for (const removed of ['Neues Tasting', 'Abgeschlossene Tastings']) {
			expect(page.getByText(removed).elements()).toHaveLength(0);
		}
	});

	test('orders greeting, next, last, admin card and tiles for the admin', async () => {
		render(Page, { data: { user: admin, ...bothTastings, tastingSummary: emptySummary } });
		await expect.element(page.getByRole('link', { name: /Tasting-Verwaltung/ })).toBeVisible();

		expectInOrder(
			page.getByRole('heading', { level: 1 }).element(),
			heading('Nächstes Tasting'),
			heading('Letztes Tasting'),
			heading('Tasting-Verwaltung'),
			page.getByText('Historie', { exact: true }).element()
		);
		// Tastings are created via "Neues Tasting" on /admin/tastings, not here.
		expect(hrefs()).toEqual(['/tasting/fluffy-otter', '/tasting/sleepy-panda', '/admin/tastings']);
		expect(page.getByText('Demnächst').elements()).toHaveLength(COMING_SOON.length);
	});

	test('shows the admin both cards even without a participation', async () => {
		render(Page, { data: { user: admin, ...noTastings, tastingSummary: emptySummary } });
		await expect.element(page.getByRole('link', { name: /Tasting-Verwaltung/ })).toBeVisible();
		await expect.element(page.getByRole('heading', { name: 'Nächstes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		expect(hrefs()).toEqual(['/admin/tastings']);
	});
});
