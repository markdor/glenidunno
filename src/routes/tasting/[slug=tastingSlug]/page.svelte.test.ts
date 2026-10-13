import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// The page builds download links from the slug of its own URL.
const SLUG = 'fluffy-otter';
vi.mock('$app/state', () => ({ page: { params: { slug: 'fluffy-otter' } } }));

import Page from './+page.svelte';
import { toast } from '$lib/components/toastStore.svelte';

const tasting = { name: 'Herbst-Tasting', tastingDate: '2026-10-24' };

const savedBottle = {
	slot: 1,
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
};

// No admin button pressed unless a test says otherwise.
const noManual = { orderOpenedAt: null, revealedAt: null };

function renderView(view: Record<string, unknown>, form: unknown = null) {
	return render(Page, { data: { user: null, view: { manual: noManual, ...view } }, form } as never);
}

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('Tasting participant page', () => {
	test('keeps the page title neutral', async () => {
		renderView({
			phase: 'order',
			tasting,
			order: [{ position: 1, alias: 'Nebel', score: 75.2, presentation: null }]
		});
		await expect.poll(() => document.title).toBe('Whisky-Tasting');
	});

	test('shows one card per bottle during entry, filled with the own bottles', async () => {
		renderView({
			phase: 'entry',
			tasting,
			participant: { username: 'Anna' },
			bottles: [{ ...savedBottle, slot: 2 }]
		});

		await expect.element(page.getByText('Hallo Anna 👋')).toBeVisible();
		await expect
			.element(page.getByText(/Schreib das Synonym auf deine verhüllte Flasche/))
			.toHaveTextContent(/am Sa\., 24\.10\.2026 ab 18 Uhr, die Auflösung am Tag danach ab 9 Uhr/);
		await expect.element(page.getByRole('form', { name: 'Flasche 1' })).toBeVisible();
		const second = page.getByRole('form', { name: 'Flasche 2' });
		await expect.element(second.getByLabelText('Synonym *')).toHaveValue('Nebel');
	});

	test('shows slots 1 and 2 plus every slot with a saved bottle, in order', async () => {
		renderView({
			phase: 'entry',
			tasting,
			participant: { username: 'Anna' },
			bottles: [5, 3].map((slot) => ({ ...savedBottle, slot, alias: `Flasche ${slot}` }))
		});

		await expect
			.poll(() =>
				page
					.getByRole('heading', { level: 2 })
					.elements()
					.map((h) => h.textContent)
			)
			.toEqual(['Flasche 1', 'Flasche 2', 'Flasche 3', 'Flasche 5']);
		await expect
			.element(page.getByRole('form', { name: 'Flasche 3' }).getByLabelText('Synonym *'))
			.toHaveValue('Flasche 3');
	});

	describe('further bottles', () => {
		const entry = { phase: 'entry', tasting, participant: { username: 'Anna' } };
		const add = page.getByRole('button', { name: 'Weitere Flasche' });

		test('adds slots up to 6, then the button is gone', async () => {
			renderView({ ...entry, bottles: [] });

			for (const slot of [3, 4, 5, 6]) {
				await add.click();
				await expect
					.element(page.getByRole('form', { name: `Flasche ${slot}` }).getByLabelText('Synonym *'))
					.toHaveValue('');
			}
			await expect.element(add).not.toBeInTheDocument();
			expect(page.getByRole('form').elements()).toHaveLength(6);
		});

		test('offers no further slot with six saved bottles', async () => {
			renderView({
				...entry,
				bottles: [1, 2, 3, 4, 5, 6].map((slot) => ({ ...savedBottle, slot, alias: `F${slot}` }))
			});

			await expect.element(page.getByRole('form', { name: 'Flasche 6' })).toBeVisible();
			expect(add.elements()).toHaveLength(0);
		});

		test('fills the smallest free slot first', async () => {
			renderView({
				...entry,
				bottles: [1, 2, 4].map((slot) => ({ ...savedBottle, slot, alias: `F${slot}` }))
			});

			await add.click();
			await expect
				.poll(() =>
					page
						.getByRole('heading', { level: 2 })
						.elements()
						.map((h) => h.textContent)
				)
				.toEqual(['Flasche 1', 'Flasche 2', 'Flasche 3', 'Flasche 4']);
		});

		// The alias was taken: the failed save of slot 3 stays in `form`.
		const takenAlias = {
			action: 'save',
			slot: 3,
			values: { alias: 'Nebel' },
			fieldErrors: { alias: 'taken' }
		};
		const card = (slot: number) => page.getByRole('form', { name: `Flasche ${slot}` });

		test('starts a re-added slot empty instead of with its failed save', async () => {
			renderView({ ...entry, bottles: [] }, takenAlias);

			await add.click();
			await expect.element(card(3).getByLabelText('Synonym *')).toHaveValue('Nebel');
			await expect.element(card(3).getByText(/Schon vergeben/)).toBeVisible();

			await page.getByRole('button', { name: 'Flasche 3 entfernen' }).click();
			await expect.element(card(3)).not.toBeInTheDocument();
			await add.click();

			await expect.element(card(3).getByLabelText('Synonym *')).toHaveValue('');
			expect(
				card(3)
					.getByText(/Schon vergeben/)
					.elements()
			).toHaveLength(0);
		});

		test('keeps the errors of another card when hiding a slot', async () => {
			renderView({ ...entry, bottles: [] }, takenAlias);

			await add.click();
			await add.click();
			await page.getByRole('button', { name: 'Flasche 4 entfernen' }).click();

			await expect.element(card(4)).not.toBeInTheDocument();
			await expect.element(card(3).getByText(/Schon vergeben/)).toBeVisible();
			await expect.element(card(3).getByLabelText('Synonym *')).toHaveValue('Nebel');
		});

		test('hides an added card again without asking', async () => {
			renderView({ ...entry, bottles: [] });

			await add.click();
			await page.getByRole('button', { name: 'Flasche 3 entfernen' }).click();

			await expect.element(page.getByRole('form', { name: 'Flasche 3' })).not.toBeInTheDocument();
			await expect.element(add).toBeVisible();
		});
	});

	test('passes field errors only to the card they belong to', async () => {
		renderView(
			{
				phase: 'entry',
				tasting,
				participant: { username: 'Anna' },
				bottles: []
			},
			{ action: 'save', slot: 2, values: {}, fieldErrors: { distillery: 'required' } }
		);

		const first = page.getByRole('form', { name: 'Flasche 1' });
		const second = page.getByRole('form', { name: 'Flasche 2' });
		await expect.element(second.getByText('Pflichtfeld')).toBeVisible();
		expect(first.getByText('Pflichtfeld').elements()).toHaveLength(0);
	});

	test('shows the numbered aliases and the total-score chart in the order phase', async () => {
		renderView({
			phase: 'order',
			tasting,
			order: [
				{ position: 1, alias: 'Blume', score: 35.2, presentation: null },
				{ position: 2, alias: 'Nebel', score: 75.2, presentation: null }
			]
		});

		await expect.element(page.getByRole('heading', { name: 'Tastingreihenfolge' })).toBeVisible();
		await expect.element(page.getByRole('listitem').nth(1)).toHaveTextContent(/2.*Nebel/);
		expect(page.getByRole('form').elements()).toHaveLength(0);
		await expect.element(page.getByRole('img', { name: /Gesamtscore/ })).toBeVisible();
		expect(page.getByRole('img').elements()).toHaveLength(1);
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
			view: { order: [{ position: 1, alias: 'Nebel', score: 75.2, presentation: null }] },
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

	test('links presentations through the tasting link in the order phase', async () => {
		renderView({
			phase: 'order',
			tasting,
			order: [{ position: 1, alias: 'Nebel', score: 75.2, presentation: { bottleId: 'b1' } }]
		});

		await expect
			.element(page.getByRole('link', { name: 'Präsentation zu Nebel' }))
			.toHaveAttribute('href', `/tasting/${SLUG}/presentation/b1`);
	});

	test('links presentations through the tasting link after the reveal', async () => {
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
			.toHaveAttribute('href', `/tasting/${SLUG}/presentation/b1`);
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
