import { describe, test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { SubmitFunction } from '@sveltejs/kit';

// Rendered through the bottle form, as the participant page does: enhance is
// replaced like in TastingBottleForm.svelte.test.ts.
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, _submit: SubmitFunction) => ({ destroy() {} })
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

import type { FactsBottle } from '$lib/tastingFacts';
import TastingBottleForm from './TastingBottleForm.svelte';

const saved: FactsBottle = {
	alias: 'Bernstein',
	distillery: 'Glenfarclas',
	bottler: null,
	bottling: null,
	age: 12,
	whiskybaseUrl: null,
	abv: 46,
	facts: {
		peat: 'light',
		cask: { kind: 'known', type: 'sherry_oloroso', refill: true },
		finish: { kind: 'other', label: 'Tequila', influence: 3, months: 9 },
		priceCents: 5990
	}
};

function renderFacts(bottle: FactsBottle | null, result: Record<string, unknown> | null = null) {
	return render(TastingBottleForm, { slot: 1, bottle, algorithm: 'facts', result });
}

const sent = () =>
	Object.fromEntries(
		new FormData(document.querySelector<HTMLFormElement>('form[action="?/save"]')!)
	);

describe('TastingFactsFields', () => {
	test('shows the facts fields instead of the sliders for a new bottle', async () => {
		renderFacts(null);

		expect(page.getByRole('slider', { name: 'Rauch *' }).elements()).toHaveLength(0);
		for (const answer of ['nein', 'leicht', 'stark']) {
			await expect.element(page.getByRole('radio', { name: answer })).not.toBeChecked();
		}
		await expect.element(page.getByLabelText('Hauptreifung *')).toHaveValue('');
		await expect.element(page.getByLabelText('Nachreifung *')).toHaveValue('none');
		await expect.element(page.getByLabelText(/Preis in €/)).toBeRequired();
		// Neither refill, other cask nor duration before a cask is picked.
		expect(page.getByRole('checkbox', { name: 'Refill' }).elements()).toHaveLength(0);
		expect(page.getByLabelText('Dauer in Monaten').elements()).toHaveLength(0);
	});

	test('offers the casks grouped, plus other and unknown', async () => {
		renderFacts(null);
		const select = page.getByLabelText('Hauptreifung *').element() as HTMLSelectElement;
		expect(Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)).toEqual([
			'Bourbon',
			'Sherry',
			'Wein',
			'Sonstige Spirituosen und Fässer'
		]);
		expect(Array.from(select.options).map((o) => o.value)).toEqual([
			'',
			'bourbon',
			'sherry_fino',
			'sherry_oloroso',
			'sherry',
			'sherry_px',
			'red_wine',
			'port',
			'madeira',
			'rum',
			'cognac',
			'virgin_oak',
			'other',
			'unknown'
		]);
	});

	test('fills in the saved facts', async () => {
		renderFacts(saved);

		await expect.element(page.getByRole('radio', { name: 'leicht' })).toBeChecked();
		await expect.element(page.getByLabelText('Hauptreifung *')).toHaveValue('sherry_oloroso');
		await expect
			.element(page.getByRole('checkbox', { name: 'Refill (Hauptreifung)' }))
			.toBeChecked();
		await expect.element(page.getByLabelText('Nachreifung *')).toHaveValue('other');
		await expect.element(page.getByLabelText('Bezeichnung (Nachreifung) *')).toHaveValue('Tequila');
		await expect
			.element(page.getByRole('slider', { name: 'Fass-Einfluss (Nachreifung) *' }))
			.toHaveValue('3');
		await expect.element(page.getByLabelText('Dauer in Monaten')).toHaveValue(9);
		await expect.element(page.getByLabelText(/Preis in €/)).toHaveValue(59.9);
		expect(sent()).toMatchObject({
			peat: 'light',
			mainCask: 'sherry_oloroso',
			mainCaskRefill: 'on',
			finish: 'other',
			finishLabel: 'Tequila',
			finishInfluence: '3',
			finishMonths: '9',
			price: '59.9'
		});
	});

	test('explains the refill checkbox, linked to it', async () => {
		renderFacts(null);
		await page.getByLabelText('Hauptreifung *').selectOptions('bourbon');

		const refill = page.getByRole('checkbox', { name: 'Refill (Hauptreifung)' });
		await expect.element(refill).not.toBeChecked();
		await expect
			.element(refill)
			.toHaveAccessibleDescription(
				'Ein Refill-Fass war schon mehrmals mit Whisky belegt und gibt weniger Aroma ab. Mit Haken rechnet die App mit weniger Fass-Einfluss. Nur ankreuzen, wenn Etikett oder Shop Refill nennen – wenn du es nicht weißt, frei lassen, dann gilt ein typisches Fass.'
			);
	});

	test('offers no refill for virgin oak, name and rating for another cask', async () => {
		renderFacts(null);
		const cask = page.getByLabelText('Hauptreifung *');

		await cask.selectOptions('virgin_oak');
		expect(page.getByRole('checkbox', { name: 'Refill' }).elements()).toHaveLength(0);

		await cask.selectOptions('other');
		await expect
			.element(page.getByLabelText('Bezeichnung (Hauptreifung) *'))
			.toHaveAttribute('maxlength', '40');
		const rating = page.getByRole('slider', { name: 'Fass-Einfluss (Hauptreifung) *' });
		await expect.element(rating).toHaveValue('5');
		await expect
			.element(rating)
			.toHaveAccessibleDescription(/2 = zart, 5 = deutlich, 8 = dominant/);
		await rating.fill('8');
		await expect.element(page.getByText('8', { exact: true })).toBeVisible();
	});

	test('tells the fields of main maturation and finish apart', async () => {
		renderFacts(null);
		const cask = page.getByLabelText('Hauptreifung *');
		const finish = page.getByLabelText('Nachreifung *');

		await cask.selectOptions('sherry');
		await finish.selectOptions('port');
		await userEvent.click(page.getByRole('checkbox', { name: 'Refill (Nachreifung)' }));
		await expect
			.element(page.getByRole('checkbox', { name: 'Refill (Hauptreifung)' }))
			.not.toBeChecked();
		expect(sent()).toMatchObject({ finishRefill: 'on' });
		expect(sent()).not.toHaveProperty('mainCaskRefill');

		await cask.selectOptions('other');
		await finish.selectOptions('other');
		await page.getByLabelText('Bezeichnung (Hauptreifung) *').fill('Tequila');
		await page.getByLabelText('Bezeichnung (Nachreifung) *').fill('Mizunara');
		await page.getByRole('slider', { name: 'Fass-Einfluss (Nachreifung) *' }).fill('7');
		expect(sent()).toMatchObject({
			mainCaskLabel: 'Tequila',
			mainCaskInfluence: '5',
			finishLabel: 'Mizunara',
			finishInfluence: '7'
		});
	});

	test('explains an unknown cask and finish', async () => {
		renderFacts(null);
		await page.getByLabelText('Hauptreifung *').selectOptions('unknown');
		await expect
			.element(page.getByText('Ohne Angabe rechnet die App mit einem Standardwert.'))
			.toBeVisible();
		await page.getByLabelText('Nachreifung *').selectOptions('unknown');
		await expect
			.element(page.getByText('Ohne Angabe rechnet die App wie ohne Nachreifung.'))
			.toBeVisible();
		expect(page.getByLabelText('Dauer in Monaten').elements()).toHaveLength(0);
	});

	test('asks for the duration only with a finish', async () => {
		renderFacts(null);
		await page.getByLabelText('Nachreifung *').selectOptions('sherry_px');
		await expect
			.element(page.getByLabelText('Dauer in Monaten'))
			.toHaveAccessibleDescription('Leer lassen, wenn die Dauer unbekannt ist.');
		await page.getByLabelText('Nachreifung *').selectOptions('none');
		expect(page.getByLabelText('Dauer in Monaten').elements()).toHaveLength(0);
	});

	test('disables the price for an unknown price, so it isn’t sent', async () => {
		renderFacts(null);
		const price = page.getByLabelText(/Preis in €/);
		await price.fill('49.9');
		await userEvent.click(page.getByRole('checkbox', { name: 'Preis unbekannt' }));

		await expect.element(price).toBeDisabled();
		await expect.element(price).not.toBeRequired();
		expect(sent()).toMatchObject({ priceUnknown: 'on' });
		expect(sent()).not.toHaveProperty('price');
	});

	test('picks a peat level with the segment buttons', async () => {
		renderFacts(null);
		await userEvent.click(page.getByText('stark', { exact: true }));
		expect(sent()).toMatchObject({ peat: 'heavy' });
	});

	test('shows the sent values and the field errors of a failed save', async () => {
		renderFacts(saved, {
			values: {
				peat: 'none',
				mainCask: 'unknown',
				mainCaskRefill: '',
				finish: 'none',
				price: '5',
				priceUnknown: ''
			},
			fieldErrors: { price: 'invalid', peat: 'required' }
		});

		await expect.element(page.getByRole('radio', { name: 'nein' })).toBeChecked();
		await expect.element(page.getByLabelText('Hauptreifung *')).toHaveValue('unknown');
		await expect.element(page.getByLabelText(/Preis in €/)).toHaveValue(5);
		await expect
			.element(page.getByText('10 bis 999 €, höchstens zwei Nachkommastellen'))
			.toBeVisible();
		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
	});
});
