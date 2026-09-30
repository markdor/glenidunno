import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// The page builds download links from the token of its own URL.
const TOKEN = 'a'.repeat(32);
vi.mock('$app/state', () => ({ page: { params: { token: 'a'.repeat(32) } } }));

import Page from './+page.svelte';
import { toast } from '$lib/components/toastStore.svelte';

const tasting = { name: 'Herbst-Tasting', tastingDate: '2026-10-24' };

// No admin button pressed unless a test says otherwise.
const noManual = { orderOpenedAt: null, revealedAt: null };

function renderView(view: Record<string, unknown>, form: unknown = null) {
	return render(Page, { data: { user: null, view: { manual: noManual, ...view } }, form } as never);
}

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('Tasting link page', () => {
	test('keeps the page title neutral', async () => {
		renderView({
			phase: 'order',
			tasting,
			order: [{ position: 1, alias: 'Nebel' }],
			curves: [[0], [0.2], [0.4], [1]]
		});
		await expect.poll(() => document.title).toBe('Whisky-Tasting');
	});

	test('shows one card per bottle during entry, filled with the own bottles', async () => {
		renderView({
			phase: 'entry',
			tasting: { ...tasting, bottlesPerParticipant: 2 },
			participant: { name: 'Anna' },
			bottles: [
				{
					slot: 2,
					alias: 'Nebel',
					distillery: 'Ardbeg',
					bottler: null,
					bottling: null,
					age: null,
					whiskybaseUrl: null,
					smoke: 5,
					cask: 2,
					abv: 46,
					value: 3
				}
			]
		});

		await expect.element(page.getByText('Hallo Anna 👋')).toBeVisible();
		await expect
			.element(page.getByText(/Schreib das Synonym auf deine verhüllte Flasche/))
			.toHaveTextContent(/am Sa\., 24\.10\.2026 ab 18 Uhr, die Auflösung am Tag danach ab 9 Uhr/);
		await expect.element(page.getByRole('form', { name: 'Flasche 1' })).toBeVisible();
		const second = page.getByRole('form', { name: 'Flasche 2' });
		await expect.element(second.getByLabelText('Synonym *')).toHaveValue('Nebel');
	});

	test('passes field errors only to the card they belong to', async () => {
		renderView(
			{
				phase: 'entry',
				tasting: { ...tasting, bottlesPerParticipant: 2 },
				participant: { name: 'Anna' },
				bottles: []
			},
			{ action: 'save', slot: 2, values: {}, fieldErrors: { distillery: 'required' } }
		);

		const first = page.getByRole('form', { name: 'Flasche 1' });
		const second = page.getByRole('form', { name: 'Flasche 2' });
		await expect.element(second.getByText('Pflichtfeld')).toBeVisible();
		expect(first.getByText('Pflichtfeld').elements()).toHaveLength(0);
	});

	test('shows the numbered aliases and the unlabeled chart in the order phase', async () => {
		renderView({
			phase: 'order',
			tasting,
			order: [
				{ position: 1, alias: 'Blume' },
				{ position: 2, alias: 'Nebel' }
			],
			curves: [
				[0, 1],
				[0.1, 0.5],
				[0.2, 0.6],
				[0.8, 0.8]
			]
		});

		await expect.element(page.getByRole('heading', { name: 'Tastingreihenfolge' })).toBeVisible();
		await expect.element(page.getByRole('listitem').nth(1)).toHaveTextContent(/2.*Nebel/);
		expect(page.getByRole('form').elements()).toHaveLength(0);
		await expect
			.element(page.getByRole('img', { name: /nicht zugeordneten Faktoren/ }))
			.toBeVisible();
	});

	test('shows the reveal without the score breakdown', async () => {
		renderView({
			phase: 'revealed',
			tasting,
			bottles: [
				{
					position: 1,
					alias: 'Nebel',
					distillery: 'Ardbeg',
					bottler: null,
					bottling: null,
					age: 10,
					whiskybaseUrl: null,
					smoke: 5,
					cask: 2,
					abv: 46,
					value: 3,
					broughtBy: 'Anna',
					score: 67
				}
			]
		});

		await expect.element(page.getByRole('heading', { name: 'Auflösung' })).toBeVisible();
		await expect.element(page.getByText('10 Jahre')).toBeVisible();
		expect(page.getByText('Score-Aufschlüsselung').elements()).toHaveLength(0);
		await expect
			.element(page.getByRole('heading', { name: 'Wie kommt die Reihenfolge zustande?' }))
			.toBeVisible();
	});

	test.each([
		{
			phase: 'order',
			view: { order: [{ position: 1, alias: 'Nebel' }], curves: [[0], [0], [0], [0]] },
			manual: { orderOpenedAt: new Date('2026-10-24T15:32:00Z'), revealedAt: null },
			notice: 'Der Admin hat die Reihenfolge am Sa., 24.10.2026 um 17:32 Uhr vorzeitig freigegeben.'
		},
		{
			phase: 'revealed',
			view: { bottles: [] },
			manual: { orderOpenedAt: null, revealedAt: new Date('2026-10-24T20:05:00Z') },
			notice: 'Der Admin hat das Tasting am Sa., 24.10.2026 um 22:05 Uhr vorzeitig aufgelöst.'
		}
	])(
		'tells when the admin changed the $phase phase by hand',
		async ({ phase, view, manual, notice }) => {
			renderView({ phase, tasting, manual, ...view });
			await expect.element(page.getByText(notice)).toBeVisible();
		}
	);

	test('links presentations through the own token after the reveal', async () => {
		renderView({
			phase: 'revealed',
			tasting,
			bottles: [
				{
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
					presentation: { bottleId: 'b1', name: 'Ardbeg.pptx' }
				}
			]
		});

		await expect
			.element(page.getByRole('link', { name: 'Präsentation: Ardbeg.pptx' }))
			.toHaveAttribute('href', `/tasting/${TOKEN}/presentation/b1`);
	});

	test('reports a general save failure as a toast', async () => {
		renderView(
			{ phase: 'order', tasting, order: [], curves: [[], [], [], []] },
			{ action: 'save', slot: 1, userMessage: 'Die Eingabe ist geschlossen.', reload: true }
		);
		expect(
			toast.toasts.some(
				(t) => t.variant === 'error' && t.message === 'Die Eingabe ist geschlossen.'
			)
		).toBe(true);
	});
});
