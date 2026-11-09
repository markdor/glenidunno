import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

const user = { id: 'u1', username: 'maxi', isAdmin: false };

const tastings = [
	{
		id: 't2',
		name: 'Islay gegen den Rest',
		subtitle: 'Tasting #18',
		tastingDate: '2026-10-24',
		bottleCount: 7
	},
	{ id: 't1', name: 'Tasting #17', subtitle: null, tastingDate: '2026-07-11', bottleCount: 1 }
];

describe('Tasting history page', () => {
	test('links every revealed tasting to its page, like the tasting management lists them', async () => {
		render(Page, { data: { user, tastings } });

		await expect.element(page.getByRole('heading', { name: 'Tasting-Historie' })).toBeVisible();
		const autumn = page.getByRole('link', { name: /Islay gegen den Rest/ });
		await expect.element(autumn).toHaveAttribute('href', '/tastings/t2');
		const lines = [...autumn.element().querySelectorAll('.min-w-0 > p')].map((p) => p.textContent);
		// The number between motto and date, only with a motto.
		expect(lines).toEqual(['Islay gegen den Rest', 'Tasting #18', 'Sa., 24.10.2026']);
		await expect.element(autumn).toHaveTextContent(/7 Flaschen/);
		const summer = page.getByRole('link', { name: /Tasting #17/ });
		await expect.element(summer).toHaveAttribute('href', '/tastings/t1');
		await expect.element(summer).toHaveTextContent(/1 Flasche$/);
	});

	test('offers the way back to the start page and says when nothing is revealed', async () => {
		render(Page, { data: { user, tastings: [] } });

		await expect
			.element(page.getByRole('link', { name: 'Startseite' }))
			.toHaveAttribute('href', '/');
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		expect(page.getByRole('listitem').elements()).toHaveLength(0);
	});
});
