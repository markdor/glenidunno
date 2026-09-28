import { test, expect } from '@playwright/test';

// Only the entry phase can be tested end-to-end: the server clock can't be
// controlled from Playwright, so order and reveal are covered by route and
// component tests.

const ALIASES = ['Nebelhorn', 'Blütenmeer'];
const DISTILLERIES = ['Ardbeg', 'Glenkinchie'];

// A week ahead is in the future in any time zone.
function dateInDays(days: number): string {
	return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.describe('Tasting – Eingabephase', () => {
	test('Admin legt an, Teilnehmer trägt ohne Login ein, Admin sieht nur den Fortschritt', async ({
		page,
		browser
	}) => {
		// Default storageState of the e2e project: the logged-in admin.
		await page.goto('/admin/tastings/new');
		await page.getByLabel('Name *').fill(`E2E-Tasting ${Date.now()}`);
		await page.getByLabel('Datum *').fill(dateInDays(7));
		await page.getByLabel('Teilnehmer 1').fill('Anna');
		await page.getByLabel('Teilnehmer 2').fill('Ben');
		await page.getByRole('button', { name: 'Tasting anlegen' }).click();
		await expect(page.getByRole('heading', { name: 'Tasting angelegt' })).toBeVisible();

		// The link is read from the one-time display as text – no clipboard permission.
		const annaUrl = (
			await page
				.getByRole('listitem')
				.filter({ hasText: 'Anna' })
				.getByText(/\/tasting\/[A-Za-z0-9_-]{32}$/)
				.textContent()
		)?.trim();
		expect(annaUrl).toBeTruthy();
		const detailHref = await page.getByRole('link', { name: 'Zum Tasting' }).getAttribute('href');

		await test.step('Teilnehmer trägt zwei Flaschen ein', async () => {
			const participant = await browser.newContext({
				storageState: { cookies: [], origins: [] }
			});
			const p = await participant.newPage();
			await p.goto(annaUrl!);
			await expect(p).toHaveTitle('Whisky-Tasting');
			await expect(p.getByText('Hallo Anna 👋')).toBeVisible();

			for (const [i, alias] of ALIASES.entries()) {
				const slot = i + 1;
				const card = p.getByRole('form', { name: `Flasche ${slot}` });
				await card.getByLabel('Synonym *').fill(alias);
				await card.getByLabel('Distillery *').fill(DISTILLERIES[i]);
				await card.getByLabel('Alkohol in % *').fill('46');
				await card.getByRole('button', { name: `Flasche ${slot} speichern` }).click();
				await expect(
					p.getByRole('status').filter({ hasText: `Flasche ${slot} gespeichert.` })
				).toBeVisible();
			}
			await participant.close();
		});

		await test.step('Admin sieht den Fortschritt, aber keine Inhalte', async () => {
			await page.goto(detailHref!);
			await expect(
				page.getByRole('listitem').filter({ hasText: 'Anna' }).getByText('2 von 2 Flaschen')
			).toBeVisible();
			await expect(
				page.getByRole('listitem').filter({ hasText: 'Ben' }).getByText('0 von 2 Flaschen')
			).toBeVisible();

			// The serialized load result must not contain the content either: once
			// embedded in the server-rendered HTML, once as __data.json.
			const htmlResponse = await page.request.get(detailHref!);
			// Links are shown once on these pages, so nothing may be cached.
			expect(htmlResponse.headers()['cache-control']).toBe('no-store');
			const html = await htmlResponse.text();
			const data = await (await page.request.get(`${detailHref}/__data.json`)).text();
			expect(html).toContain('2 von 2 Flaschen');
			for (const secret of [...ALIASES, ...DISTILLERIES]) {
				expect(html).not.toContain(secret);
				expect(data).not.toContain(secret);
			}
		});
	});
});

test.describe('Tasting – anonym', () => {
	// The e2e project's default storageState is the logged-in admin.
	test.use({ storageState: { cookies: [], origins: [] } });

	for (const path of [
		'/admin/tastings',
		'/admin/tastings/new',
		// Fixed on purpose: Playwright needs identical test titles in every worker.
		'/admin/tastings/00000000-0000-4000-8000-000000000000',
		'/tasting',
		'/tasting/kein-gueltiges-token'
	]) {
		test(`${path} leitet auf /login um`, async ({ request }) => {
			const res = await request.get(path, { maxRedirects: 0 });
			expect(res.status()).toBe(302);
			expect(res.headers()['location']).toBe('/login');
		});
	}

	test('ein gültig formatiertes, unbekanntes Token liefert 404 mit Security-Headern', async ({
		request
	}) => {
		const res = await request.get(`/tasting/${'A'.repeat(32)}`, { maxRedirects: 0 });
		expect(res.status()).toBe(404);
		expect(res.headers()).toMatchObject({
			'referrer-policy': 'no-referrer',
			'x-robots-tag': 'noindex, nofollow',
			'cache-control': 'no-store'
		});
	});
});
