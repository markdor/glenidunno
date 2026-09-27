import { test, expect } from '@playwright/test';

// The e2e project's default storageState is the logged-in admin (see
// playwright.config.ts) — this test verifies the anonymous path, so it must
// start from a clean, unauthenticated session.
test.use({ storageState: { cookies: [], origins: [] } });

// DB-free smoke test that runs both locally and against the deployed container
// (docker:test). Verifies the closed-app guard: an anonymous request is
// redirected to /login and the magic-link form renders.
test.describe('Closed App', () => {
	test('anonymer Aufruf von / landet auf /login mit Formular', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByLabel('E-Mail')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Link anfordern' })).toBeVisible();
	});
});
