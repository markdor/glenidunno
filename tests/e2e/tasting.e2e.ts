import { test, expect } from '@playwright/test';

// The server clock can't be controlled from Playwright: order and reveal are
// reached here via the admin's 18-Uhr/9-Uhr buttons, the clock-based switch
// at 18:00 and 9:00 is covered by route and component tests.
//
// The participant page is reached via the start page's hero, but this spec
// only checks the arrival: entering bottles and the presentation downloads
// are covered by route and component tests.

// A week ahead is in the future in any time zone.
function dateInDays(days: number): string {
	return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// An old token link (base64url, 32 characters) and a slug of words that
// aren't in the lists (no tasting can have it).
const OLD_TOKEN_LINK = `/tasting/${'A'.repeat(32)}`;
const UNKNOWN_SLUG_LINK = '/tasting/fluffy-nothing';

test.describe('Tasting – Ablauf', () => {
	test('Admin legt mit einem weiteren User ein Tasting an und gibt Reihenfolge und Auflösung frei', async ({
		page
	}) => {
		// Default storageState of the e2e project: the logged-in admin. The
		// address is unique per run, so a retry doesn't fail on "taken".
		const guest = `gast_${Date.now().toString(36)}`;
		const tastingName = `E2E-Tasting ${Date.now()}`;

		await test.step('Admin legt den zweiten Teilnehmer als User an', async () => {
			await page.goto('/admin');
			await page.getByLabel('E-Mail *').fill(`${guest}@e2e.test`);
			await page.getByLabel('Benutzername *').fill(guest);
			await page.getByRole('button', { name: 'Anlegen' }).click();
			await expect(page.getByText('Benutzer angelegt.')).toBeVisible();
		});

		await test.step('Admin wählt die Teilnehmer per Checkbox und landet auf der Detailseite', async () => {
			await page.goto('/admin/tastings/new');
			await page.getByLabel('Name *').fill(tastingName);
			await page.getByLabel('Datum *').fill(dateInDays(7));
			await page.getByRole('checkbox', { name: 'admin', exact: true }).check();
			// The whole row is the label: tapping the name ticks the box.
			await page.getByText(guest, { exact: true }).click();
			await expect(page.getByRole('checkbox', { name: guest })).toBeChecked();
			await page.getByRole('button', { name: 'Tasting anlegen' }).click();
			await expect(page).toHaveURL(/\/admin\/tastings\/[0-9a-f-]{36}$/);
		});

		const detailUrl = page.url();

		// The admin page carries management data only and no link at all: the
		// serialized load result must not contain one either – once embedded
		// in the server-rendered HTML, once as __data.json.
		async function expectNoLinkOnAdminPage() {
			const html = await (await page.request.get(detailUrl)).text();
			const data = await (await page.request.get(`${detailUrl}/__data.json`)).text();
			for (const body of [html, data]) expect(body).not.toMatch(/\/tasting\/[a-z]+-[a-z]+/);
		}

		await test.step('Admin sieht beide Teilnehmer mit Fortschritt, aber keinen Link', async () => {
			for (const name of ['admin', guest]) {
				await expect(
					page
						.getByRole('listitem')
						.filter({ has: page.getByText(name, { exact: true }) })
						.getByText('0 von 2 Flaschen')
				).toBeVisible();
			}
			await expect(page.getByRole('button', { name: /Link/ })).toHaveCount(0);
			await expectNoLinkOnAdminPage();
		});

		await test.step('Admin gelangt als Teilnehmer über den Hero der Startseite ins Tasting', async () => {
			// Smallest phone width: the dashboard must not scroll sideways, not
			// even with the admin's extra cards and the long e2e name.
			const viewport = page.viewportSize();
			await page.setViewportSize({ width: 360, height: 800 });
			await page.goto('/');
			const nextCard = page.getByRole('link', { name: /Nächstes Tasting/ });
			await expect(nextCard).toContainText(tastingName);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
				)
			).toBe(true);

			// Both tasting cards have one size, although the next one shows more
			// lines (phase, progress) than the last one. Only real CSS shows that.
			const lastCard = page.getByRole('heading', { name: 'Letztes Tasting' }).locator('..');
			const [next, last] = await Promise.all([nextCard.boundingBox(), lastCard.boundingBox()]);
			expect(next).not.toBeNull();
			expect(last?.width).toBeCloseTo(next?.width ?? 0, 0);
			expect(last?.height).toBeCloseTo(next?.height ?? 0, 0);

			// The heading, not the card's center (see CLAUDE.md, E2E clicks on cards).
			await page.getByRole('heading', { name: 'Nächstes Tasting' }).click();
			await expect(page).toHaveURL(/\/tasting\/[a-z]+-[a-z]+$/);
			await expect(page.getByRole('heading', { level: 1, name: tastingName })).toBeVisible();

			if (viewport) await page.setViewportSize(viewport);
			await page.goto(detailUrl);
		});

		const openOrderButton = page.getByRole('button', { name: 'Reihenfolge jetzt freigeben' });
		const revealButton = page.getByRole('button', { name: 'Jetzt auflösen' });

		async function pressPhaseButton(button: typeof openOrderButton, confirmLabel: string) {
			await button.click();
			await page.getByRole('dialog').getByRole('button', { name: confirmLabel }).click();
		}

		await test.step('18-Uhr-Button: Reihenfolge vorzeitig freigeben', async () => {
			// The reveal can't skip the order.
			await expect(openOrderButton).toBeEnabled();
			await expect(revealButton).toBeDisabled();

			await pressPhaseButton(openOrderButton, 'Freigeben');
			await expect(openOrderButton).toBeDisabled();
			await expect(revealButton).toBeEnabled();
			await expect(
				page.getByText(
					/^Der Admin hat die Reihenfolge am .+ um \d\d:\d\d Uhr vorzeitig freigegeben\.$/
				)
			).toBeVisible();
		});

		await test.step('9-Uhr-Button: Tasting vorzeitig auflösen', async () => {
			await pressPhaseButton(revealButton, 'Auflösen');
			await expect(revealButton).toBeDisabled();
			await expect(openOrderButton).toBeDisabled();
			await expect(page.getByText(/vorzeitig aufgelöst\.$/)).toBeVisible();
			await expectNoLinkOnAdminPage();
		});
	});
});

test.describe('Tasting – Zugriff ohne Login', () => {
	// The e2e project's default storageState is the logged-in admin.
	test.use({ storageState: { cookies: [], origins: [] } });

	for (const path of [
		'/admin/tastings',
		'/admin/tastings/new',
		// Fixed on purpose: Playwright needs identical test titles in every worker.
		'/admin/tastings/00000000-0000-4000-8000-000000000000',
		'/tasting',
		UNKNOWN_SLUG_LINK,
		`${UNKNOWN_SLUG_LINK}/presentation/some-id`,
		// The anonymous token links of old are gone for good.
		OLD_TOKEN_LINK
	]) {
		test(`${path} leitet auf /login um`, async ({ request }) => {
			const res = await request.get(path, { maxRedirects: 0 });
			expect(res.status()).toBe(302);
			expect(res.headers()['location']).toBe('/login');
		});
	}
});

test.describe('Tasting – Zugriff mit Login', () => {
	const NOT_FOUND_LOCATION = '/?notice=not-found';
	const NOT_FOUND_TEXT = 'Diese Seite gibt es nicht (mehr).';
	// The bare dashboard: no ?notice left behind.
	const DASHBOARD_URL = /^https?:\/\/[^/]+\/$/;

	// Unknown slug, old token link, unknown path and unknown admin ID: one
	// response for all of them, so it doesn't reveal which case applied.
	for (const path of [
		UNKNOWN_SLUG_LINK,
		OLD_TOKEN_LINK,
		'/gibt-es-nicht',
		'/admin/tastings/00000000-0000-4000-8000-000000000000'
	]) {
		test(`${path} leitet mit derselben Antwort aufs Dashboard um`, async ({ request }) => {
			const res = await request.get(path, { maxRedirects: 0 });
			expect(res.status()).toBe(303);
			expect(res.headers()['location']).toBe(NOT_FOUND_LOCATION);
		});
	}

	test('die Umleitung von der Teilnehmerseite wird nicht gecacht', async ({ request }) => {
		const res = await request.get(UNKNOWN_SLUG_LINK, { maxRedirects: 0 });
		expect(res.headers()['cache-control']).toBe('no-store');
	});

	test('das Dashboard zeigt den Hinweis einmal und entfernt ihn aus der URL', async ({ page }) => {
		const notice = page.getByRole('status').filter({ hasText: NOT_FOUND_TEXT });

		await test.step('Direktaufruf eines alten Token-Links', async () => {
			await page.goto(OLD_TOKEN_LINK);
			await expect(notice).toBeVisible();
			// Without the parameter a reload doesn't show the toast again.
			await expect(page).toHaveURL(DASHBOARD_URL);
			await notice.getByRole('button', { name: 'Schließen' }).click();
			await expect(notice).toHaveCount(0);
		});

		await test.step('Client-Navigation auf einen unbekannten Pfad', async () => {
			// A full page load would drop this marker.
			await page.evaluate(() => {
				(window as unknown as { noReload: boolean }).noReload = true;
				const link = document.createElement('a');
				link.href = '/gibt-es-nicht';
				link.textContent = 'Kaputter Link';
				document.querySelector('main')!.append(link);
			});
			await page.getByRole('link', { name: 'Kaputter Link' }).click();
			await expect(notice).toBeVisible();
			await expect(page).toHaveURL(DASHBOARD_URL);
			expect(
				await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)
			).toBe(true);
		});
	});
});
