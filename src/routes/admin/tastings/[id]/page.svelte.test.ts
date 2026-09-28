import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { toast } from '$lib/components/toastStore.svelte';

const user = { id: 'admin-id', username: 'admin', isAdmin: true };

const base = {
	tasting: {
		id: 't1',
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 2
	},
	participants: [
		{ id: 'p1', name: 'Anna', progress: { entered: 1, total: 2 } },
		{ id: 'p2', name: 'Ben', progress: { entered: 2, total: 2 } }
	],
	manual: { orderOpenedAt: null, revealedAt: null }
};

const revealedBottle = {
	position: 1,
	alias: 'Nebel',
	distillery: 'Ardbeg',
	bottler: null,
	bottling: null,
	age: null,
	whiskybaseUrl: null,
	smoke: 5,
	cask: 2,
	abv: 46,
	value: 3,
	broughtBy: 'Anna',
	score: 67,
	breakdown: { smoke: 40, cask: 12, abv: 6, value: 6 },
	presentation: { bottleId: 'b1', name: 'Ardbeg.pptx' }
};

function renderDetail(detail: Record<string, unknown>, form: unknown = null) {
	return render(Page, {
		data: { user, today: '2026-10-20', detail: { ...base, ...detail } },
		form
	} as never);
}

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('Tasting detail page', () => {
	test('shows participants with progress and the date form during entry', async () => {
		renderDetail({ phase: 'entry' });

		await expect.element(page.getByRole('heading', { name: 'Herbst-Tasting' })).toBeVisible();
		await expect.element(page.getByText('1 von 2 Flaschen')).toBeVisible();
		await expect.element(page.getByText('2 von 2 Flaschen')).toBeVisible();
		await expect
			.element(
				page.getByText('Die Inhalte siehst du wie alle anderen erst am Tasting-Tag ab 18 Uhr.')
			)
			.toBeVisible();
		await expect.element(page.getByLabelText('Datum')).toHaveValue('2026-10-24');
		await expect.element(page.getByLabelText('Datum')).toHaveAttribute('min', '2026-10-20');
	});

	test('shows the pouring order from 18:00 and no date form', async () => {
		renderDetail({ phase: 'order', order: [{ position: 1, alias: 'Nebel' }] });

		await expect.element(page.getByRole('heading', { name: 'Reihenfolge' })).toBeVisible();
		await expect.element(page.getByText('Nebel')).toBeVisible();
		expect(page.getByLabelText('Datum').elements()).toHaveLength(0);
	});

	test('shows the reveal with the score breakdown and the admin download link', async () => {
		renderDetail({ phase: 'revealed', bottles: [revealedBottle] });

		await expect.element(page.getByRole('heading', { name: 'Auflösung' })).toBeVisible();
		await expect.element(page.getByText('Score-Aufschlüsselung')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Präsentation: Ardbeg.pptx' }))
			.toHaveAttribute('href', '/admin/tastings/t1/presentation/b1');
	});

	test('offers a new link per participant in every phase', async () => {
		renderDetail({ phase: 'order', order: [] });
		expect(page.getByRole('button', { name: 'Link neu generieren' }).elements()).toHaveLength(2);
	});

	test('shows a regenerated link once, next to its participant', async () => {
		const url = 'https://glenidunno.test/tasting/' + 'c'.repeat(32);
		renderDetail(
			{ phase: 'entry' },
			{ action: 'regenerate', regenerated: { participantId: 'p2', link: { name: 'Ben', url } } }
		);

		await expect.element(page.getByText(url)).toBeVisible();
		await expect.element(page.getByText(/Die Links werden nur jetzt angezeigt/)).toBeVisible();
	});

	test('shows date errors and keeps the sent date', async () => {
		renderDetail(
			{ phase: 'entry' },
			{ action: 'updateDate', tastingDate: '2026-10-01', fieldErrors: { tastingDate: 'invalid' } }
		);
		await expect.element(page.getByText('Ungültig oder in der Vergangenheit')).toBeVisible();
		await expect.element(page.getByLabelText('Datum')).toHaveValue('2026-10-01');
	});

	test('reports failures and a changed date as toasts', async () => {
		renderDetail({ phase: 'entry' }, { action: 'updateDate', userMessage: 'Geht nicht mehr.' });
		expect(
			toast.toasts.some((t) => t.variant === 'error' && t.message === 'Geht nicht mehr.')
		).toBe(true);

		renderDetail({ phase: 'entry' }, { action: 'updateDate', updated: true });
		expect(
			toast.toasts.some((t) => t.variant === 'success' && t.message === 'Datum geändert.')
		).toBe(true);
	});

	describe('18-Uhr and 9-Uhr buttons', () => {
		test('offers both buttons during entry', async () => {
			renderDetail({ phase: 'entry' });
			await expect
				.element(page.getByRole('button', { name: 'Reihenfolge jetzt freigeben' }))
				.toBeVisible();
			await expect.element(page.getByRole('button', { name: 'Jetzt auflösen' })).toBeVisible();
		});

		test('offers only the reveal once the order is shown', async () => {
			renderDetail({ phase: 'order', order: [] });
			expect(
				page.getByRole('button', { name: 'Reihenfolge jetzt freigeben' }).elements()
			).toHaveLength(0);
			await expect.element(page.getByRole('button', { name: 'Jetzt auflösen' })).toBeVisible();
		});

		test('offers no button after the reveal', async () => {
			renderDetail({ phase: 'revealed', bottles: [] });
			expect(page.getByRole('button', { name: 'Jetzt auflösen' }).elements()).toHaveLength(0);
			expect(page.getByRole('heading', { name: 'Vorzeitig freigeben' }).elements()).toHaveLength(0);
		});

		test('shows when the admin pressed a button', async () => {
			renderDetail({
				phase: 'order',
				order: [],
				manual: { orderOpenedAt: new Date('2026-10-24T15:32:00Z'), revealedAt: null }
			});
			await expect
				.element(page.getByText(/Reihenfolge am Sa\., 24\.10\.2026 um 17:32 Uhr vorzeitig/))
				.toBeVisible();
		});

		test.each([
			{ action: 'openOrder', message: 'Reihenfolge freigegeben.' },
			{ action: 'reveal', message: 'Tasting aufgelöst.' }
		])('confirms $action with a toast', async ({ action, message }) => {
			renderDetail({ phase: 'order', order: [] }, { action, phaseChanged: true });
			expect(toast.toasts.some((t) => t.variant === 'success' && t.message === message)).toBe(true);
		});
	});

	describe('confirmation before irreversible actions', () => {
		// Real enhance, only the action requests are intercepted (see admin/page.svelte.test.ts).
		let actionRequests: string[];

		beforeEach(() => {
			actionRequests = [];
			const passThrough = window.fetch.bind(window);
			vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
				const url = input instanceof Request ? input.url : String(input);
				if (!url.includes('?/')) return passThrough(input, init);
				actionRequests.push(url);
				// Never settles: the tests only care whether the request was sent.
				return new Promise<Response>(() => {});
			});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		test.each([
			{ button: 'Tasting löschen', question: 'Herbst-Tasting' },
			{ button: 'Reihenfolge jetzt freigeben', question: 'Reihenfolge jetzt' },
			{ button: 'Jetzt auflösen', question: 'komplett auflösen' }
		])('sends nothing when "$button" is not confirmed', async ({ button, question }) => {
			const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
			renderDetail({ phase: 'entry' });

			await page.getByRole('button', { name: button }).click();

			expect(confirm).toHaveBeenCalledWith(expect.stringContaining(question));
			expect(actionRequests).toHaveLength(0);
		});

		test.each([
			{ button: 'Tasting löschen', action: '?/delete' },
			{ button: 'Reihenfolge jetzt freigeben', action: '?/openOrder' },
			{ button: 'Jetzt auflösen', action: '?/reveal' }
		])('sends $action once "$button" is confirmed', async ({ button, action }) => {
			vi.spyOn(window, 'confirm').mockReturnValue(true);
			renderDetail({ phase: 'entry' });

			await page.getByRole('button', { name: button }).click();

			await expect.poll(() => actionRequests).toHaveLength(1);
			expect(actionRequests[0]).toContain(action);
		});
	});
});
