import { test, expect, type Page } from '@playwright/test';
import {
	E2E_ADMIN_EMAIL,
	MAGIC_LINK_EMAIL_TEST_LIMIT,
	countMagicLinkLines,
	waitForNewMagicLink
} from './magic-link';

// Not in the user table -> requesting a link for it is a whitelist miss.
const UNKNOWN_EMAIL = 'nicht-registriert@e2e.test';

async function requestLink(page: Page, email: string) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(email);
	await page.getByRole('button', { name: 'Link anfordern' }).click();
}

// The e2e project's default storageState is the logged-in admin (see
// playwright.config.ts) — this test verifies the login flow itself, so it
// must start from a clean, unauthenticated session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Magic-Link-Login', () => {
	test('Admin meldet sich per Magic Link an und sieht die Begrüßungsseite', async ({
		page,
		baseURL
	}) => {
		expect(baseURL).toBeTruthy();

		// Closed app: an unauthenticated call to / lands on /login.
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);

		// Enter email address and request the link.
		await page.getByLabel('E-Mail').fill(E2E_ADMIN_EMAIL);
		const linesBefore = countMagicLinkLines();
		await page.getByRole('button', { name: 'Link anfordern' }).click();

		// Always the same (neutral) confirmation – regardless of whitelist hit or miss.
		await expect(page.getByRole('status')).toContainText(/wurde ein Link verschickt/i);

		// Follow the link -> session cookie set, redirect to the start page.
		const magicLink = await waitForNewMagicLink(linesBefore);
		await page.goto(magicLink);
		await expect(page).toHaveURL(new URL('/', baseURL!).toString());

		// Greeting page checks the username in the header and in the heading.
		await expect(page.getByRole('heading', { name: /Hallo admin/i })).toBeVisible();
		await expect(page.getByRole('button', { name: 'admin' })).toBeVisible();
	});

	test('Nicht freigeschaltete Adresse bekommt dieselbe Meldung, aber keinen Link', async ({
		page
	}) => {
		const linesBefore = countMagicLinkLines();
		await requestLink(page, UNKNOWN_EMAIL);

		// Same neutral confirmation as a hit – nothing here reveals that the
		// address is unknown.
		await expect(page.getByRole('status')).toContainText(/wurde ein Link verschickt/i);

		// ...but no link was ever produced. The helper polls for ~3s and throws
		// when no new line shows up, which is exactly what we assert here.
		await expect(waitForNewMagicLink(linesBefore)).rejects.toThrow();
	});

	// Must stay last in this file: it burns the shared admin account's per-email
	// quota for the rest of the run. Only auth.setup.ts (a separate, always-first
	// project) and this file request fresh links at all, and every run starts
	// from a clean DB – so nothing downstream is affected.
	test('Über dem Rate-Limit gibt es dieselbe Meldung, aber keinen Link', async ({
		page,
		request
	}) => {
		// Burn the quota via the API instead of the form – same endpoint the login
		// page calls, just without paying for a page load each time. Overshooting
		// is intentional: earlier logins in this run already used part of it.
		for (let i = 0; i < MAGIC_LINK_EMAIL_TEST_LIMIT; i++) {
			const res = await request.post('/auth/sign-in/magic-link', {
				data: { email: E2E_ADMIN_EMAIL, callbackURL: '/' }
			});
			// Over-quota requests are answered exactly like accepted ones.
			expect(res.ok()).toBe(true);
		}

		const linesBefore = countMagicLinkLines();
		await requestLink(page, E2E_ADMIN_EMAIL);

		await expect(page.getByRole('status')).toContainText(/wurde ein Link verschickt/i);
		await expect(waitForNewMagicLink(linesBefore)).rejects.toThrow();
	});
});
