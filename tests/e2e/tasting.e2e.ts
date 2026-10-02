import { test, expect } from '@playwright/test';

// The server clock can't be controlled from Playwright: order and reveal are
// reached here via the admin's 18-Uhr/9-Uhr buttons, the clock-based switch
// at 18:00 and 9:00 is covered by route and component tests.

const ALIASES = ['Nebelhorn', 'Blütenmeer'];
const DISTILLERIES = ['Ardbeg', 'Glenkinchie'];
// Uploaded with the first bottle, downloaded through the link from the order on.
const PRESENTATION = {
	name: 'Vortrag Flasche 1.pptx',
	mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	buffer: Buffer.from('PK\u0003\u0004 not really a deck, stored byte for byte')
};

// A week ahead is in the future in any time zone.
function dateInDays(days: number): string {
	return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.describe('Tasting – Ablauf', () => {
	test('Admin legt an, Teilnehmer trägt ohne Login ein, Admin gibt Reihenfolge und Auflösung frei', async ({
		page,
		browser
	}) => {
		// Default storageState of the e2e project: the logged-in admin.
		await page.goto('/admin/tastings/new');
		await page.getByLabel('Name *').fill(`E2E-Tasting ${Date.now()}`);
		const tastingDate = dateInDays(7);
		await page.getByLabel('Datum *').fill(tastingDate);
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

		const participant = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const p = await participant.newPage();

		await test.step('Teilnehmer trägt zwei Flaschen ein', async () => {
			await p.goto(annaUrl!);
			await expect(p).toHaveTitle('Whisky-Tasting');
			await expect(p.getByText('Hallo Anna 👋')).toBeVisible();

			for (const [i, alias] of ALIASES.entries()) {
				const slot = i + 1;
				const card = p.getByRole('form', { name: `Flasche ${slot}` });
				await card.getByLabel('Synonym *').fill(alias);
				await card.getByLabel('Distillery *').fill(DISTILLERIES[i]);
				await card.getByLabel('Alkohol in % *').fill('46');
				if (slot === 1) await card.getByLabel('Präsentation').setInputFiles(PRESENTATION);
				await card.getByRole('button', { name: `Flasche ${slot} speichern` }).click();
				await expect(
					p.getByRole('status').filter({ hasText: `Flasche ${slot} gespeichert.` })
				).toBeVisible();
			}
			await expect(p.getByText(`Hochgeladen: ${PRESENTATION.name}`)).toBeVisible();
		});

		// The admin page carries management data only, in every phase: the
		// serialized load result must not contain any content either – once
		// embedded in the server-rendered HTML, once as __data.json.
		async function expectNoContentOnAdminPage() {
			const htmlResponse = await page.request.get(detailHref!);
			// Links are shown once on these pages, so nothing may be cached.
			expect(htmlResponse.headers()['cache-control']).toBe('no-store');
			const html = await htmlResponse.text();
			const data = await (await page.request.get(`${detailHref}/__data.json`)).text();
			expect(html).toContain('2 von 2 Flaschen');
			for (const secret of [...ALIASES, ...DISTILLERIES, PRESENTATION.name]) {
				expect(html).not.toContain(secret);
				expect(data).not.toContain(secret);
			}
		}

		const openOrderButton = page.getByRole('button', { name: 'Reihenfolge jetzt freigeben' });
		const revealButton = page.getByRole('button', { name: 'Jetzt auflösen' });

		async function pressPhaseButton(button: typeof openOrderButton, confirmLabel: string) {
			await button.click();
			await page.getByRole('dialog').getByRole('button', { name: confirmLabel }).click();
		}

		await test.step('Admin sieht den Fortschritt, aber keine Inhalte', async () => {
			await page.goto(detailHref!);
			await expect(
				page.getByRole('listitem').filter({ hasText: 'Anna' }).getByText('2 von 2 Flaschen')
			).toBeVisible();
			await expect(
				page.getByRole('listitem').filter({ hasText: 'Ben' }).getByText('0 von 2 Flaschen')
			).toBeVisible();
			await expectNoContentOnAdminPage();
			// The reveal can't skip the order.
			await expect(openOrderButton).toBeEnabled();
			await expect(revealButton).toBeDisabled();
		});

		await test.step('18-Uhr-Button: alle Links zeigen nur die Reihenfolge samt Hinweis', async () => {
			await pressPhaseButton(openOrderButton, 'Freigeben');
			await expect(openOrderButton).toBeDisabled();
			await expect(revealButton).toBeEnabled();
			await expectNoContentOnAdminPage();

			await p.reload();
			await expect(p.getByRole('heading', { name: 'Tastingreihenfolge' })).toBeVisible();
			await expect(
				p.getByText(
					/^Der Admin hat die Reihenfolge am .+ um \d\d:\d\d Uhr vorzeitig freigegeben\.$/
				)
			).toBeVisible();
			await expect(p.getByText(`1. ${ALIASES[0]}`)).toBeVisible();
			await expect(p.getByRole('img', { name: /Gesamtscore/ })).toBeVisible();
			const html = await (await p.request.get(annaUrl!)).text();
			for (const name of [...DISTILLERIES, PRESENTATION.name]) expect(html).not.toContain(name);
			await expect(p.getByRole('form')).toHaveCount(0);
		});

		await test.step('Präsentation: ab der Reihenfolge herunterladbar, unter neutralem Namen', async () => {
			const href = await p
				.getByRole('link', { name: `Präsentation zu ${ALIASES[0]}` })
				.getAttribute('href');
			const download = await p.request.get(href!);
			expect(download.status()).toBe(200);
			// Stored name (date + alias): the original one may reveal the whisky.
			const disposition = download.headers()['content-disposition'];
			expect(disposition).toContain(`filename="Tasting_${tastingDate}_${ALIASES[0]}`);
			expect(disposition).not.toContain('Vortrag');
			expect(Buffer.compare(await download.body(), PRESENTATION.buffer)).toBe(0);
		});

		await test.step('9-Uhr-Button: alle Links zeigen die Auflösung samt Hinweis', async () => {
			await pressPhaseButton(revealButton, 'Auflösen');
			await expect(revealButton).toBeDisabled();
			await expect(openOrderButton).toBeDisabled();
			await expectNoContentOnAdminPage();

			await p.reload();
			await expect(p.getByRole('heading', { name: 'Auflösung' })).toBeVisible();
			await expect(p.getByText(/vorzeitig aufgelöst\.$/)).toBeVisible();
			for (const name of DISTILLERIES) await expect(p.getByText(name)).toBeVisible();
		});

		await test.step('Präsentation: nach der Auflösung verlinkt und 1:1 herunterladbar', async () => {
			const href = await p
				.getByRole('link', { name: `Präsentation: ${PRESENTATION.name}` })
				.getAttribute('href');
			const download = await p.request.get(href!);
			expect(download.status()).toBe(200);
			expect(download.headers()['content-disposition']).toMatch(/^attachment;/);
			expect(download.headers()['x-content-type-options']).toBe('nosniff');
			expect(Buffer.compare(await download.body(), PRESENTATION.buffer)).toBe(0);
		});

		await participant.close();
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
