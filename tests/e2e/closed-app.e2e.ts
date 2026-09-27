import { test, expect } from '@playwright/test';

// The e2e project's default storageState is the logged-in admin (see
// playwright.config.ts) — this test verifies the anonymous path, so it must
// start from a clean, unauthenticated session.
test.use({ storageState: { cookies: [], origins: [] } });

// DB-free smoke tests that run both locally and against the deployed container
// (docker:test). Verify the closed-app guard: an anonymous request is
// redirected to /login and the magic-link form renders, while static assets
// (served before the guard runs) stay publicly reachable.
test.describe('Closed App', () => {
	test('anonymer Aufruf von / landet auf /login mit Formular', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByLabel('E-Mail')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Link anfordern' })).toBeVisible();
	});

	test('Logo auf /login lädt ohne Login', async ({ page }) => {
		await page.goto('/login');
		const logo = page.getByRole('img', { name: 'Glen Idunno' });
		await expect(logo).toBeVisible();
		// A redirect to /login instead of the SVG would leave the image undecoded.
		await expect
			.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
			.toBeGreaterThan(0);
	});

	// maxRedirects: 0 – a missing file in static/ falls through to the guard and
	// answers 302 → /login, which the default redirect-following would hide.
	test('/favicon.svg ist ohne Login erreichbar', async ({ request }) => {
		const res = await request.get('/favicon.svg', { maxRedirects: 0 });
		expect(res.status()).toBe(200);
	});

	test('/site.webmanifest ist ohne Login erreichbar und nutzt die Creme-Farbe', async ({
		request
	}) => {
		const res = await request.get('/site.webmanifest', { maxRedirects: 0 });
		expect(res.status()).toBe(200);
		const manifest = await res.json();
		expect(manifest.theme_color).toBe('#f3ebdd');
	});
});
