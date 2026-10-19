import { describe, test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { HistoryBottle } from '$lib/tasting';

// The table reads its state from page.url and writes it back via goto(): the
// real goto() needs a running SvelteKit client.
const mockPage = vi.hoisted(() => ({ url: new URL('http://localhost/history') }));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';

const user = { id: 'u-anna', username: 'Anna', isAdmin: false };

const BOTTLE: HistoryBottle = {
	number: 1,
	tastingDate: '2021-05-07',
	motto: null,
	slug: null,
	alias: 'P1',
	distillery: 'Glen Spey',
	bottler: 'Hunter Laing',
	bottling: null,
	age: 24,
	abv: 54.1,
	whiskybaseUrl: null,
	broughtBy: 'Anna',
	presentation: null
};

describe('/history', () => {
	test('shows the bottle table under the page heading', async () => {
		render(Page, { data: { user, bottles: [BOTTLE] } });

		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Historie' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Startseite' }))
			.toHaveAttribute('href', '/');
		const table = page.getByRole('region', { name: 'Alle Flaschen' });
		const row = table.getByRole('row').filter({ hasText: 'P1' }).first();
		await expect.element(row).toHaveTextContent('Glen Spey 24 Jahre');
		expect(document.getElementById('bottle-1')).not.toBeNull();
		expect(document.title).toBe('Historie · Glen Idunno');
	});

	test('shows the empty state while nothing is revealed', async () => {
		render(Page, { data: { user, bottles: null } });

		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		await expect.element(page.getByRole('table')).not.toBeInTheDocument();
	});
});
