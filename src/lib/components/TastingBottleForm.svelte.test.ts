import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { SubmitFunction } from '@sveltejs/kit';

// enhance is replaced so the submit callback can be driven directly – the
// real one would need a running SvelteKit client for update()/invalidateAll().
const captured = vi.hoisted(() => ({ submit: null as SubmitFunction | null }));
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
		captured.submit = submit;
		return { destroy() {} };
	}
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

import { invalidateAll } from '$app/navigation';
import TastingBottleForm from './TastingBottleForm.svelte';
import { toast } from './toastStore.svelte';

const saved = {
	alias: 'Nebel',
	distillery: 'Ardbeg',
	bottler: null,
	bottling: 'Uigeadail',
	age: null,
	whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1',
	smoke: 5,
	cask: 3,
	abv: 54.2,
	value: 4
};

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
	vi.clearAllMocks();
	captured.submit = null;
});

async function runSubmit(result: Record<string, unknown>) {
	const update = vi.fn(async () => {});
	const after = await captured.submit!({} as Parameters<SubmitFunction>[0]);
	await (after as (opts: unknown) => Promise<void>)({ result, update });
	return update;
}

describe('TastingBottleForm', () => {
	test('renders an empty card for a new bottle', async () => {
		render(TastingBottleForm, { slot: 2, bottle: null });

		await expect.element(page.getByRole('form', { name: 'Flasche 2' })).toBeVisible();
		await expect.element(page.getByLabelText('Synonym *')).toHaveValue('');
		await expect.element(page.getByLabelText('Alkohol in % *')).toHaveValue(null);
		await expect.element(page.getByRole('slider', { name: 'Rauch *' })).toHaveValue('0');
		await expect.element(page.getByRole('button', { name: 'Flasche 2 speichern' })).toBeVisible();
	});

	test('fills the card with the saved bottle', async () => {
		render(TastingBottleForm, { slot: 1, bottle: saved });

		await expect.element(page.getByLabelText('Synonym *')).toHaveValue('Nebel');
		await expect.element(page.getByLabelText('Distillery *')).toHaveValue('Ardbeg');
		await expect.element(page.getByLabelText('Abfüller')).toHaveValue('');
		await expect.element(page.getByLabelText('Abfüllung')).toHaveValue('Uigeadail');
		await expect.element(page.getByLabelText('Alkohol in % *')).toHaveValue(54.2);
		await expect.element(page.getByLabelText('Whiskybase-Link')).toHaveValue(saved.whiskybaseUrl);
		await expect.element(page.getByRole('slider', { name: 'Fass *' })).toHaveValue('3');
	});

	test('explains the fields right at the field instead of a tooltip', async () => {
		render(TastingBottleForm, { slot: 1, bottle: null });

		await expect
			.element(page.getByText('Leer lassen, wenn der Whisky keine Altersangabe hat (NAS).'))
			.toBeVisible();
		await expect.element(page.getByText('Leer lassen bei Originalabfüllung.')).toBeVisible();
		await expect
			.element(page.getByText('0 = kein Rauch, 5 = Laphroaig-/Ardbeg-Niveau'))
			.toBeVisible();
		await expect
			.element(page.getByText('0 = Alltagsflasche, 5 = Highlight des Abends'))
			.toBeVisible();
	});

	test('shows the current slider value', async () => {
		render(TastingBottleForm, { slot: 1, bottle: saved });
		const slider = page.getByRole('slider', { name: 'Wertigkeit *' });
		const output = page.getByRole('status').filter({ hasText: /^\d$/ });
		await expect.element(slider).toHaveValue('4');

		(slider.element() as HTMLInputElement).value = '1';
		slider.element().dispatchEvent(new Event('input', { bubbles: true }));

		await expect.poll(() => output.elements().map((o) => o.textContent?.trim())).toContain('1');
	});

	test('shows field errors and keeps the sent values', async () => {
		render(TastingBottleForm, {
			slot: 1,
			bottle: saved,
			result: {
				values: { ...saved, alias: 'Blume', abv: '80', whiskybaseUrl: 'https://evil.example' },
				fieldErrors: {
					alias: 'taken',
					abv: 'invalid',
					whiskybaseUrl: 'invalid',
					distillery: 'required'
				}
			} as never
		});

		await expect.element(page.getByLabelText('Synonym *')).toHaveValue('Blume');
		await expect.element(page.getByText(/Schon vergeben/)).toBeVisible();
		await expect
			.element(page.getByText('35 bis 75 %, höchstens eine Nachkommastelle'))
			.toBeVisible();
		await expect.element(page.getByText('Nur https-Links auf whiskybase.com')).toBeVisible();
		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
	});

	test('confirms a successful save and keeps the form filled', async () => {
		render(TastingBottleForm, { slot: 2, bottle: null });

		const update = await runSubmit({ type: 'success', status: 200, data: { saved: true } });

		expect(update).toHaveBeenCalledWith({ reset: false });
		expect(toast.toasts.map((t) => [t.variant, t.message])).toContainEqual([
			'success',
			'Flasche 2 gespeichert.'
		]);
		expect(invalidateAll).not.toHaveBeenCalled();
	});

	test('reloads the page once the entry phase has ended', async () => {
		render(TastingBottleForm, { slot: 1, bottle: saved });

		await runSubmit({ type: 'failure', status: 422, data: { reload: true } });

		expect(invalidateAll).toHaveBeenCalledOnce();
		expect(toast.toasts.filter((t) => t.variant === 'success')).toHaveLength(0);
	});

	test('keeps the page as it is on other failures', async () => {
		render(TastingBottleForm, { slot: 1, bottle: saved });

		await runSubmit({ type: 'failure', status: 429, data: { userMessage: 'Zu viele' } });

		expect(invalidateAll).not.toHaveBeenCalled();
	});
});
