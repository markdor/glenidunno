import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

const user = { id: '1', username: 'maxi', isAdmin: false };
const admin = { id: '2', username: 'admin', isAdmin: true };

describe('Start page', () => {
	test('greets the logged-in user', async () => {
		render(Page, { data: { user, tastingSummary: null } });
		await expect.element(page.getByRole('heading', { name: /Hallo maxi/ })).toBeVisible();
	});

	test('shows non-admins the empty-state hint and no tasting card', async () => {
		render(Page, { data: { user, tastingSummary: null } });
		await expect.element(page.getByText('Hier entsteht bald das Tasting.')).toBeVisible();
		expect(page.getByRole('link', { name: /Whisky-Tasting/ }).elements()).toHaveLength(0);
	});

	test('shows the admin the tasting card instead of the empty-state hint', async () => {
		render(Page, {
			data: { user: admin, tastingSummary: { upcomingCount: 0, preview: [] } }
		});
		await expect.element(page.getByRole('link', { name: /Whisky-Tasting/ })).toBeVisible();
		expect(page.getByText('Hier entsteht bald das Tasting.').elements()).toHaveLength(0);
	});
});
