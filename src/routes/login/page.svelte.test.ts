import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { EMAIL_LENGTH } from '$lib/validation';
import { toast } from '$lib/components/toastStore.svelte';

const { magicLink } = vi.hoisted(() => ({
	magicLink: vi.fn(async () => ({ data: {}, error: null }))
}));
vi.mock('$lib/auth-client', () => ({ authClient: { signIn: { magicLink } } }));

import Page from './+page.svelte';

beforeEach(() => {
	magicLink.mockClear();
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('Login page', () => {
	test('renders the email form by default', async () => {
		render(Page, { data: { user: null, error: null } });
		await expect.element(page.getByRole('heading', { name: 'Glen Idunno' })).toBeVisible();
		await expect.element(page.getByLabelText('E-Mail')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Link anfordern' })).toBeVisible();
	});

	test('shows the generic error toast when data.error is set', async () => {
		render(Page, { data: { user: null, error: 'invalid' } });
		// The page no longer renders the box itself - it triggers the global
		// toast store, rendered separately by <Toast/> in +layout.svelte.
		await expect
			.poll(() =>
				toast.toasts.some(
					(t) => t.variant === 'error' && /abgelaufen oder wurde bereits/.test(t.message)
				)
			)
			.toBe(true);
	});

	test('rejects an invalid email without calling the API', async () => {
		render(Page, { data: { user: null, error: null } });
		await page.getByLabelText('E-Mail').fill('not-an-email');
		await page.getByRole('button', { name: 'Link anfordern' }).click();

		await expect.element(page.getByText(/gültige E-Mail-Adresse/)).toBeVisible();
		expect(magicLink).not.toHaveBeenCalled();
	});

	test('accepts an email at exactly the maximum length', async () => {
		render(Page, { data: { user: null, error: null } });
		const email = `${'a'.repeat(EMAIL_LENGTH.max - '@example.de'.length)}@example.de`;
		await page.getByLabelText('E-Mail').fill(email);
		await page.getByRole('button', { name: 'Link anfordern' }).click();

		await expect.poll(() => magicLink.mock.calls.length).toBeGreaterThan(0);
		expect(magicLink).toHaveBeenCalledWith(expect.objectContaining({ email }));
	});

	test('rejects an email longer than the shared maximum', async () => {
		render(Page, { data: { user: null, error: null } });
		const email = `${'a'.repeat(EMAIL_LENGTH.max - '@example.de'.length + 1)}@example.de`;
		await page.getByLabelText('E-Mail').fill(email);
		await page.getByRole('button', { name: 'Link anfordern' }).click();

		await expect.element(page.getByText(/gültige E-Mail-Adresse/)).toBeVisible();
		expect(magicLink).not.toHaveBeenCalled();
	});

	test('submits a valid email and shows the generic confirmation', async () => {
		render(Page, { data: { user: null, error: null } });
		await page.getByLabelText('E-Mail').fill('User@Example.de');
		await page.getByRole('button', { name: 'Link anfordern' }).click();

		await expect
			.poll(() =>
				toast.toasts.some(
					(t) => t.variant === 'success' && /Wenn die Adresse registriert ist/.test(t.message)
				)
			)
			.toBe(true);
		// Normalised to lowercase, with the magic-link callback URLs.
		expect(magicLink).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'user@example.de', callbackURL: '/' })
		);
	});
});
