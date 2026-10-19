import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

const user = { id: 'admin-id', username: 'admin', isAdmin: true };

describe('Tasting list page', () => {
	test('lists name, date, phase and progress per tasting', async () => {
		render(Page, {
			data: {
				user,
				tastings: [
					{
						id: 't1',
						name: 'Herbst-Tasting',
						motto: null,
						tastingDate: '2026-10-24',
						phase: 'order',
						progress: { entered: 5, total: 6 }
					}
				]
			}
		});

		const item = page.getByRole('link', { name: /Herbst-Tasting/ });
		await expect.element(item).toHaveAttribute('href', '/admin/tastings/t1');
		await expect.element(item).toHaveTextContent(/Sa\., 24\.10\.2026/);
		await expect.element(item).toHaveTextContent(/Reihenfolge/);
		await expect.element(item).toHaveTextContent(/5\/6 Flaschen eingetragen/);
		// Without a motto: name and date only, no empty line in between.
		expect(item.element().querySelectorAll('.min-w-0 > p')).toHaveLength(2);
	});

	test('shows the motto heading below the name in one line', async () => {
		render(Page, {
			data: {
				user,
				tastings: [
					{
						id: 't1',
						name: 'Herbst-Tasting',
						motto: 'Islay gegen den Rest',
						tastingDate: '2026-10-24',
						phase: 'entry',
						progress: { entered: 0, total: 4 }
					}
				]
			}
		});

		const item = page.getByRole('link', { name: /Herbst-Tasting/ });
		const lines = [...item.element().querySelectorAll('.min-w-0 > p')].map((p) => p.textContent);
		expect(lines).toEqual(['Herbst-Tasting', 'Islay gegen den Rest', 'Sa., 24.10.2026']);
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
