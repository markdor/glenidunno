import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { toast } from '$lib/components/toastStore.svelte';

const tasting = { name: 'Herbst-Tasting', tastingDate: '2026-10-24' };

function renderView(view: Record<string, unknown>, form: unknown = null) {
	return render(Page, { data: { user: null, view }, form } as never);
}

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('Tasting link page', () => {
	test('keeps the page title neutral', async () => {
		renderView({
			phase: 'order',
			tasting,
			order: [{ position: 1, alias: 'Nebel' }]
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

	test('shows only the numbered aliases in the order phase', async () => {
		renderView({
			phase: 'order',
			tasting,
			order: [
				{ position: 1, alias: 'Blume' },
				{ position: 2, alias: 'Nebel' }
			]
		});

		await expect.element(page.getByRole('heading', { name: 'Ausschankreihenfolge' })).toBeVisible();
		await expect.element(page.getByRole('listitem').nth(1)).toHaveTextContent(/2.*Nebel/);
		expect(page.getByRole('form').elements()).toHaveLength(0);
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
	});

	test('reports a general save failure as a toast', async () => {
		renderView(
			{ phase: 'order', tasting, order: [] },
			{ action: 'save', slot: 1, userMessage: 'Die Eingabe ist geschlossen.', reload: true }
		);
		expect(
			toast.toasts.some(
				(t) => t.variant === 'error' && t.message === 'Die Eingabe ist geschlossen.'
			)
		).toBe(true);
	});
});
