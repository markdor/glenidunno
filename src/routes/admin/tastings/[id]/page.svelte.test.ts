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
	]
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
	breakdown: { smoke: 40, cask: 12, abv: 6, value: 6 }
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

	test('shows the reveal with the score breakdown', async () => {
		renderDetail({ phase: 'revealed', bottles: [revealedBottle] });

		await expect.element(page.getByRole('heading', { name: 'Auflösung' })).toBeVisible();
		await expect.element(page.getByText('Score-Aufschlüsselung')).toBeVisible();
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

	describe('delete confirmation', () => {
		// Real enhance, only the delete request is intercepted (see admin/page.svelte.test.ts).
		let deleteRequests: string[];

		beforeEach(() => {
			deleteRequests = [];
			const passThrough = window.fetch.bind(window);
			vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
				const url = input instanceof Request ? input.url : String(input);
				if (!url.includes('?/delete')) return passThrough(input, init);
				deleteRequests.push(url);
				return new Promise<Response>(() => {});
			});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		test('sends no request when the confirm dialog is dismissed', async () => {
			const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
			renderDetail({ phase: 'entry' });

			await page.getByRole('button', { name: 'Tasting löschen' }).click();

			expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Herbst-Tasting'));
			expect(deleteRequests).toHaveLength(0);
		});

		test('sends the delete request once confirmed', async () => {
			vi.spyOn(window, 'confirm').mockReturnValue(true);
			renderDetail({ phase: 'entry' });

			await page.getByRole('button', { name: 'Tasting löschen' }).click();

			await expect.poll(() => deleteRequests).toHaveLength(1);
		});
	});
});
