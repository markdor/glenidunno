import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
import { toast } from '$lib/components/toastStore.svelte';

const user = { id: 'admin-id', username: 'admin', isAdmin: true };

const base = {
	tasting: {
		id: 't1',
		name: 'Herbst-Tasting',
		motto: null,
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 2
	},
	participants: [
		{ id: 'p1', name: 'Anna', progress: { entered: 1, total: 2 } },
		{ id: 'p2', name: 'Ben', progress: { entered: 2, total: 2 } }
	],
	manual: { orderOpenedAt: null, revealedAt: null }
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
		await expect.element(page.getByLabelText('Datum')).toHaveValue('2026-10-24');
		await expect.element(page.getByLabelText('Datum')).toHaveAttribute('min', '2026-10-20');
	});

	test.each(['entry', 'order', 'revealed'])(
		'points to the participation for the content in phase %s',
		async (phase) => {
			renderDetail({ phase });
			await expect
				.element(
					page.getByText(
						'Hier verwaltest du nur das Tasting. Reihenfolge und Auflösung siehst du wie alle anderen als Teilnehmer des Tastings.'
					)
				)
				.toBeVisible();
			expect(page.getByRole('heading', { name: 'Reihenfolge' }).elements()).toHaveLength(0);
			expect(page.getByRole('heading', { name: 'Auflösung' }).elements()).toHaveLength(0);
		}
	);

	test.each(['entry', 'order', 'revealed'])(
		'offers the motto form with the current motto in phase %s',
		async (phase) => {
			renderDetail({ phase, tasting: { ...base.tasting, motto: 'Islay gegen den Rest' } });
			const motto = page.getByLabelText('Motto');
			await expect.element(motto).toHaveValue('Islay gegen den Rest');
			await expect.element(motto).toHaveAttribute('maxlength', '120');
			await expect.element(motto).not.toBeRequired();
			await expect.element(page.getByRole('button', { name: 'Motto speichern' })).toBeVisible();
		}
	);

	test('leaves the motto field empty without a motto', async () => {
		renderDetail({ phase: 'entry' });
		await expect.element(page.getByLabelText('Motto')).toHaveValue('');
	});

	test('shows motto errors and keeps the sent motto', async () => {
		const tooLong = 'x'.repeat(121);
		renderDetail(
			{ phase: 'order' },
			{ action: 'updateMotto', motto: tooLong, fieldErrors: { motto: 'invalid' } }
		);
		await expect.element(page.getByText('Höchstens 120 Zeichen')).toBeVisible();
		await expect.element(page.getByLabelText('Motto')).toHaveValue(tooLong);
	});

	test('offers no date form once the entry is closed', async () => {
		renderDetail({ phase: 'order' });
		expect(page.getByLabelText('Datum').elements()).toHaveLength(0);
	});

	test('shows the participants without any link mechanism', async () => {
		renderDetail({ phase: 'order' });
		await expect.element(page.getByText('Anna')).toBeVisible();
		expect(page.getByRole('button', { name: /Link/ }).elements()).toHaveLength(0);
		expect(page.getByText(/\/tasting\//).elements()).toHaveLength(0);
	});

	test('marks a deactivated participant as delivered by the load', async () => {
		renderDetail({
			phase: 'entry',
			participants: [{ id: 'p1', name: 'Anna (inaktiv)', progress: { entered: 0, total: 2 } }]
		});
		await expect.element(page.getByText('Anna (inaktiv)')).toBeVisible();
	});

	test('shows date errors and keeps the sent date', async () => {
		renderDetail(
			{ phase: 'entry' },
			{ action: 'updateDate', tastingDate: '2026-10-01', fieldErrors: { tastingDate: 'invalid' } }
		);
		await expect.element(page.getByText('Ungültig oder in der Vergangenheit')).toBeVisible();
		await expect.element(page.getByLabelText('Datum')).toHaveValue('2026-10-01');
		expect(page.getByText('Höchstens 120 Zeichen').elements()).toHaveLength(0);
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

	test('confirms a changed motto with its own toast', async () => {
		renderDetail({ phase: 'revealed' }, { action: 'updateMotto', updated: true });
		expect(toast.toasts.map((t) => [t.variant, t.message])).toEqual([
			['success', 'Motto geändert.']
		]);
	});

	describe('18-Uhr and 9-Uhr buttons', () => {
		// One step after the other: only the button for the next phase is active.
		test.each([
			{ phase: 'entry', openOrder: true, reveal: false },
			{ phase: 'order', openOrder: false, reveal: true },
			{ phase: 'revealed', openOrder: false, reveal: false }
		])('shows both buttons in phase $phase, only the next step enabled', async (c) => {
			renderDetail({ phase: c.phase });
			const openOrder = page.getByRole('button', { name: 'Reihenfolge jetzt freigeben' });
			const reveal = page.getByRole('button', { name: 'Jetzt auflösen' });
			await expect.element(openOrder).toBeVisible();
			await expect.element(reveal).toBeVisible();
			if (c.openOrder) await expect.element(openOrder).toBeEnabled();
			else await expect.element(openOrder).toBeDisabled();
			if (c.reveal) await expect.element(reveal).toBeEnabled();
			else await expect.element(reveal).toBeDisabled();
		});

		test('shows when the admin pressed a button', async () => {
			renderDetail({
				phase: 'order',
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
			renderDetail({ phase: 'order' }, { action, phaseChanged: true });
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
			{ button: 'Tasting löschen', question: 'Herbst-Tasting', phase: 'entry' },
			{ button: 'Reihenfolge jetzt freigeben', question: 'Reihenfolge jetzt', phase: 'entry' },
			{ button: 'Jetzt auflösen', question: 'komplett auflösen', phase: 'order' }
		])('sends nothing when "$button" is not confirmed', async ({ button, question, phase }) => {
			renderDetail({ phase });
			render(ConfirmDialog);

			await page.getByRole('button', { name: button }).click();
			const dialog = page.getByRole('dialog');
			await expect.element(dialog.getByText(new RegExp(question))).toBeVisible();
			await dialog.getByRole('button', { name: 'Abbrechen' }).click();

			expect(actionRequests).toHaveLength(0);
		});

		test.each([
			{ button: 'Tasting löschen', confirmLabel: 'Löschen', action: '?/delete', phase: 'entry' },
			{
				button: 'Reihenfolge jetzt freigeben',
				confirmLabel: 'Freigeben',
				action: '?/openOrder',
				phase: 'entry'
			},
			{ button: 'Jetzt auflösen', confirmLabel: 'Auflösen', action: '?/reveal', phase: 'order' }
		])(
			'sends $action once "$button" is confirmed',
			async ({ button, confirmLabel, action, phase }) => {
				renderDetail({ phase });
				render(ConfirmDialog);

				await page.getByRole('button', { name: button }).click();
				await page.getByRole('dialog').getByRole('button', { name: confirmLabel }).click();

				await expect.poll(() => actionRequests).toHaveLength(1);
				expect(actionRequests[0]).toContain(action);
			}
		);
	});
});
