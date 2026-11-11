import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const mockPage = vi.hoisted(() => ({ status: 404 }));
vi.mock('$app/state', () => ({ page: mockPage }));

import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import ErrorPage from './+error.svelte';

beforeEach(() => {
	mockPage.status = 404;
});

describe('share link error page', () => {
	test('says the same for every link that shows no bottle, without a way to the login', async () => {
		render(ErrorPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Dieser Link ist nicht mehr gültig.' }))
			.toBeVisible();
		expect(page.getByRole('link').elements()).toHaveLength(0);
		await expect.poll(() => document.title).toBe('Glen Idunno');
		expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
			'noindex'
		);
	});

	test('shows the generic text for any other error', async () => {
		mockPage.status = 500;
		render(ErrorPage);
		await expect
			.element(page.getByRole('heading', { level: 1, name: UNEXPECTED_ERROR_MESSAGE }))
			.toBeVisible();
		await expect.element(page.getByText('Fehler 500')).toBeVisible();
	});
});
