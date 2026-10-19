import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { toast } from '$lib/components/toastStore.svelte';
import type { DashboardLastTasting, DashboardTasting } from '$lib/tasting';

// The real goto() needs a running SvelteKit client.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { goto } from '$app/navigation';
import Page from './+page.svelte';

beforeEach(() => {
	vi.mocked(goto).mockClear();
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

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
const noTastings = { nextTasting: null, lastTasting: null, notice: null };
const bothTastings = { nextTasting, lastTasting, notice: null };

// Every tile has its section by now.
const COMING_SOON: string[] = [];

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
		render(Page, { data: { user, ...noTastings } });
		await expect.element(page.getByRole('heading', { name: /Hallo maxi/ })).toBeVisible();
	});

	test('links the next and the last own tasting to the participant page', async () => {
		render(Page, { data: { user, ...bothTastings } });
		await expect
			.element(page.getByRole('link', { name: /Nächstes Tasting/ }))
			.toHaveAttribute('href', '/tasting/fluffy-otter');
		await expect
			.element(page.getByRole('link', { name: /Letztes Tasting/ }))
			.toHaveAttribute('href', '/tasting/sleepy-panda');
	});

	test('shows both cards in their empty state without an own tasting', async () => {
		render(Page, { data: { user, ...noTastings } });
		await expect.element(page.getByText('Kein Tasting geplant.')).toBeVisible();
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		// Only the tiles.
		expect(hrefs()).toEqual(['/tastings', '/history', '/statistics', '/map']);
	});

	test('links everybody to both histories, the statistics and the world map, no section is still to come', async () => {
		render(Page, { data: { user, ...bothTastings } });
		for (const title of COMING_SOON) {
			await expect.element(page.getByText(title, { exact: true })).toBeVisible();
		}
		expect(page.getByText('Demnächst').elements()).toHaveLength(COMING_SOON.length);
		await expect
			.element(page.getByRole('link', { name: 'Tasting-Historie' }))
			.toHaveAttribute('href', '/tastings');
		await expect
			.element(page.getByRole('link', { name: 'Flaschen-Datenbank' }))
			.toHaveAttribute('href', '/history');
		await expect
			.element(page.getByRole('link', { name: 'Statistiken' }))
			.toHaveAttribute('href', '/statistics');
		await expect
			.element(page.getByRole('link', { name: 'Weltkarte' }))
			.toHaveAttribute('href', '/map');
		// Besides the two cards only the tiles link.
		expect(hrefs()).toEqual([
			'/tasting/fluffy-otter',
			'/tasting/sleepy-panda',
			'/tastings',
			'/history',
			'/statistics',
			'/map'
		]);
		expect(page.getByText('Tasting-Verwaltung').elements()).toHaveLength(0);
		for (const removed of ['Neues Tasting', 'Abgeschlossene Tastings']) {
			expect(page.getByText(removed).elements()).toHaveLength(0);
		}
		// Renamed to "Flaschen-Datenbank".
		expect(page.getByText('Historie', { exact: true }).elements()).toHaveLength(0);
	});

	test('orders greeting, next, last and tiles, for the admin too', async () => {
		render(Page, { data: { user: admin, ...bothTastings } });
		await expect.element(page.getByRole('heading', { name: /Hallo admin/ })).toBeVisible();

		expectInOrder(
			page.getByRole('heading', { level: 1 }).element(),
			heading('Nächstes Tasting'),
			heading('Letztes Tasting'),
			page.getByText('Tasting-Historie', { exact: true }).element()
		);
		// The tasting management is on /admin, which the header links.
		expect(hrefs()).toEqual([
			'/tasting/fluffy-otter',
			'/tasting/sleepy-panda',
			'/tastings',
			'/history',
			'/statistics',
			'/map'
		]);
		expect(page.getByText('Tasting-Verwaltung').elements()).toHaveLength(0);
		expect(page.getByText('Demnächst').elements()).toHaveLength(COMING_SOON.length);
	});

	test('shows the admin both cards even without a participation', async () => {
		render(Page, { data: { user: admin, ...noTastings } });
		await expect.element(page.getByRole('heading', { name: 'Nächstes Tasting' })).toBeVisible();
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		expect(hrefs()).toEqual(['/tastings', '/history', '/statistics', '/map']);
	});

	test('shows the not-found notice as an info toast and drops it from the URL', async () => {
		render(Page, { data: { user, ...noTastings, notice: 'not-found' } });
		await expect
			.poll(() => toast.toasts.map((t) => [t.variant, t.message]))
			.toEqual([['info', 'Diese Seite gibt es nicht (mehr).']]);
		expect(goto).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/', { replaceState: true, noScroll: true, keepFocus: true });
	});

	test('shows no toast and keeps the URL without a notice', async () => {
		render(Page, { data: { user, ...bothTastings } });
		await expect.element(page.getByRole('heading', { name: /Hallo maxi/ })).toBeVisible();
		expect(toast.toasts).toEqual([]);
		expect(goto).not.toHaveBeenCalled();
	});
});
