import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Header from './Header.svelte';

describe('Header', () => {
	test('links the app name to the start page with a decorative mark', async () => {
		render(Header, { user: { username: 'maxi', isAdmin: false } });

		const home = page.getByRole('link', { name: 'Glen Idunno' });
		await expect.element(home).toHaveAttribute('href', '/');
		// The mark is decorative – the text next to it is the accessible name.
		expect(home.element().querySelector('img')?.getAttribute('alt')).toBe('');
	});

	test('shows the username and keeps the menu closed initially', async () => {
		render(Header, { user: { username: 'maxi', isAdmin: false } });

		await expect.element(page.getByRole('button', { name: /maxi/ })).toBeVisible();
		expect(page.getByRole('menuitem', { name: 'Abmelden' }).elements()).toHaveLength(0);
	});

	test('opens the dropdown with an Abmelden entry on click', async () => {
		render(Header, { user: { username: 'maxi', isAdmin: false } });

		await page.getByRole('button', { name: /maxi/ }).click();
		await expect.element(page.getByRole('menuitem', { name: 'Abmelden' })).toBeVisible();
		// Non-admins must not see the Admin link.
		expect(page.getByRole('menuitem', { name: 'Admin' }).elements()).toHaveLength(0);
	});

	test('shows the Admin link for admins', async () => {
		render(Header, { user: { username: 'boss', isAdmin: true } });

		await page.getByRole('button', { name: /boss/ }).click();
		await expect.element(page.getByRole('menuitem', { name: 'Admin' })).toBeVisible();
	});
});
