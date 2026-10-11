import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const mockPage = vi.hoisted(() => ({
	status: 500,
	error: { message: 'SqliteError: no such table: tasting' } as { message: string } | null
}));
vi.mock('$app/state', () => ({ page: mockPage }));

import ErrorPage from './+error.svelte';

beforeEach(() => {
	mockPage.status = 500;
	mockPage.error = { message: 'SqliteError: no such table: tasting' };
});

describe('Error page', () => {
	test('shows the fixed German text, the status and a way back', async () => {
		render(ErrorPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Da ist etwas schiefgelaufen.' }))
			.toBeVisible();
		await expect.element(page.getByText('Fehlercode 500')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Zur Startseite' }))
			.toHaveAttribute('href', '/');
	});

	test('never shows the internal error message', async () => {
		render(ErrorPage);
		await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();
		expect(document.body.textContent).not.toContain('SqliteError');
	});

	test('shows the status of the error at hand', async () => {
		mockPage.status = 405;
		render(ErrorPage);
		await expect.element(page.getByText('Fehlercode 405')).toBeVisible();
	});
});
