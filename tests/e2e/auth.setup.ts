import { test as setup, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, countMagicLinkLines, waitForNewMagicLink } from './magic-link';

const authFile = 'playwright/.auth/admin.json';

// Logs the admin in once via the real magic-link flow and saves the session,
// so the `e2e` project (dependencies: ['setup']) can start every other spec
// already authenticated instead of repeating this flow per file.
setup('Admin-Session aufbauen', async ({ page, baseURL }) => {
	await page.goto('/');
	await page.getByLabel('E-Mail').fill(E2E_ADMIN_EMAIL);

	const linesBefore = countMagicLinkLines();
	await page.getByRole('button', { name: 'Link anfordern' }).click();
	await expect(page.getByRole('status')).toContainText(/wurde ein Link verschickt/i);

	const magicLink = await waitForNewMagicLink(linesBefore);
	await page.goto(magicLink);
	await expect(page).toHaveURL(new URL('/', baseURL!).toString());

	await page.context().storageState({ path: authFile });
});
