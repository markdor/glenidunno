import { test, expect } from '@playwright/test';

// The e2e project's default storageState is the logged-in admin (see
// playwright.config.ts) — this test verifies the endpoint is public even
// without a session, so it must start from a clean, unauthenticated context.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Health', () => {
	test('GET /health ist ohne Login erreichbar und liefert 200', async ({ request }) => {
		const res = await request.get('/health');
		expect(res.status()).toBe(200);
	});
});
