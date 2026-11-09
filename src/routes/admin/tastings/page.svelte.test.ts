import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

const user = { id: 'admin-id', username: 'admin', isAdmin: true };

describe('Tasting list page', () => {
	test('lists title, date, phase and progress per tasting', async () => {
		render(Page, {
			data: {
				user,
				tastings: [
					{
						id: 't1',
						name: 'Tasting #18',
						subtitle: null,
						tastingDate: '2026-10-24',
						phase: 'order',
						progress: { entered: 5, total: 6 }
					}
				]
			}
		});

		const item = page.getByRole('link', { name: /Tasting #18/ });
		await expect.element(item).toHaveAttribute('href', '/admin/tastings/t1');
		await expect.element(item).toHaveTextContent(/Sa\., 24\.10\.2026/);
		await expect.element(item).toHaveTextContent(/Reihenfolge/);
		await expect.element(item).toHaveTextContent(/5\/6 Flaschen eingetragen/);
		// Without a motto the number is the title: no subtitle.
		const lines = [...item.element().querySelectorAll('.min-w-0 > p')].map((p) => p.textContent);
		expect(lines).toEqual(['Tasting #18', 'Sa., 24.10.2026']);
	});

	test('names the number of a tasting with a motto between title and date', async () => {
		render(Page, {
			data: {
				user,
				tastings: [
					{
						id: 't1',
						name: 'Islay gegen den Rest',
						subtitle: 'Tasting #18',
						tastingDate: '2026-10-24',
						phase: 'entry',
						progress: { entered: 0, total: 4 }
					}
				]
			}
		});

		const item = page.getByRole('link', { name: /Islay gegen den Rest/ });
		const lines = [...item.element().querySelectorAll('.min-w-0 > p')].map((p) => p.textContent);
		expect(lines).toEqual(['Islay gegen den Rest', 'Tasting #18', 'Sa., 24.10.2026']);
		expect(page.getByText('Islay gegen den Rest').element().classList).toContain('truncate');
	});

	test('offers a new tasting and a way back to the admin page', async () => {
		render(Page, { data: { user, tastings: [] } });

		await expect
			.element(page.getByRole('link', { name: 'Neues Tasting' }))
			.toHaveAttribute('href', '/admin/tastings/new');
		await expect
			.element(page.getByRole('link', { name: 'Admin' }))
			.toHaveAttribute('href', '/admin');
		await expect.element(page.getByText('Noch keine Tastings angelegt.')).toBeVisible();
	});
});
