import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { SubmitFunction } from '@sveltejs/kit';

// enhance is replaced so the submit callbacks can be driven directly – the
// real one would need a running SvelteKit client (see TastingBottleForm).
const captured = vi.hoisted(() => ({ submit: {} as Record<string, SubmitFunction> }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
		captured.submit[form.getAttribute('action')!] = submit;
		return { destroy() {} };
	}
}));

import AdminDistilleryTable from './AdminDistilleryTable.svelte';
import { toast } from './toastStore.svelte';
import type { AdminDistillery } from '$lib/tasting';

const WHISKYPEDIA = 'https://scotchwhisky.com/whiskypedia/1/ardbeg/';

const ardbeg: AdminDistillery = {
	key: 'ardbeg',
	name: 'Ardbeg',
	country: { value: 'Schottland', state: 'found', source: WHISKYPEDIA },
	region: { value: 'Islay', state: 'admin', source: null },
	capacity: { value: 1_400_000, state: 'found', source: 'javascript:alert(1)' },
	costMicroUsd: 523_000
};
const bushmills: AdminDistillery = {
	key: 'bushmills',
	name: 'Bushmills',
	country: { value: 'Nordirland', state: 'admin', source: null },
	region: null,
	capacity: { value: null, state: 'empty', source: null },
	costMicroUsd: 0
};
const zuidam: AdminDistillery = {
	key: 'zuidam',
	name: 'Zuidam',
	country: { value: null, state: 'pending', source: null },
	region: null,
	capacity: { value: null, state: 'pending', source: null },
	costMicroUsd: 81_000
};

const props = (over: Record<string, unknown> = {}) => ({
	distilleries: [zuidam, bushmills, ardbeg],
	costMicroUsd: 1_234_567,
	prompt: { text: 'Regeln', custom: false },
	...over
});

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
	captured.submit = {};
});

// The names in the order of the rows.
function order(): string[] {
	return [...document.querySelectorAll('tbody tr:first-child td:first-child')].map(
		(cell) => cell.textContent?.trim() ?? ''
	);
}

function rowOf(name: string) {
	return page.getByRole('rowgroup').filter({ hasText: name });
}

async function runSubmit(result: Record<string, unknown>) {
	const action = '?/updateDistillery';
	const update = vi.fn(async () => {});
	const formElement = document.querySelector<HTMLFormElement>(`form[action="${action}"]`)!;
	const after = await captured.submit[action]({
		formElement
	} as unknown as Parameters<SubmitFunction>[0]);
	await (after as (opts: unknown) => Promise<void>)({ result, update, formElement });
	return update;
}

describe('AdminDistilleryTable', () => {
	test('shows the estimated total and every distillery with its values and costs', async () => {
		render(AdminDistilleryTable, props());

		const section = page.getByRole('region', { name: 'Destillerien' });
		await expect.element(section.getByText('1,23 $')).toBeVisible();
		await expect
			.element(section.getByText(/maßgeblich ist die Abrechnung in der Anthropic Console/))
			.toBeVisible();
		expect(order()).toEqual(['Ardbeg', 'Bushmills', 'Zuidam']);
		await expect.element(rowOf('Ardbeg').getByText('0,52 $').first()).toBeVisible();
		await expect.element(rowOf('Ardbeg').getByText('1.400.000 l A/Jahr').first()).toBeVisible();
	});

	test('tells the state of every value', async () => {
		render(AdminDistilleryTable, props());

		// A researched value links its source.
		const source = rowOf('Ardbeg').getByRole('link', { name: /Schottland/ });
		await expect.element(source).toHaveAttribute('href', WHISKYPEDIA);
		await expect.element(source).toHaveAttribute('rel', 'external noopener noreferrer');
		await expect.element(source).toHaveAttribute('target', '_blank');
		// Only http(s) becomes a link.
		expect(
			rowOf('Ardbeg')
				.getByRole('link', { name: /1\.400\.000/ })
				.elements()
		).toHaveLength(0);

		await expect.element(rowOf('Ardbeg').getByText('(vom Admin gesetzt)').first()).toBeVisible();
		await expect.element(rowOf('Bushmills').getByText('nicht gefunden').first()).toBeVisible();
		await expect
			.element(rowOf('Zuidam').getByText('noch nicht recherchiert').first())
			.toBeVisible();
	});

	test('shows no region outside Scotland, not even a state', async () => {
		render(AdminDistilleryTable, props());

		await expect.element(rowOf('Ardbeg').getByText('Islay').first()).toBeVisible();
		expect(rowOf('Bushmills').element().textContent).not.toContain('Region');
		expect(rowOf('Zuidam').element().textContent).not.toContain('Region');
	});

	test('sorts by a column heading, missing values last', async () => {
		render(AdminDistilleryTable, props());

		await page.getByRole('button', { name: 'Land', exact: true }).click();
		expect(order()).toEqual(['Bushmills', 'Ardbeg', 'Zuidam']);
		await expect
			.element(page.getByRole('columnheader', { name: 'Land' }))
			.toHaveAttribute('aria-sort', 'ascending');

		await page.getByRole('button', { name: 'Land', exact: true }).click();
		expect(order()).toEqual(['Ardbeg', 'Bushmills', 'Zuidam']);
		await expect
			.element(page.getByRole('columnheader', { name: 'Land' }))
			.toHaveAttribute('aria-sort', 'descending');
	});

	test('sorts with the controls that replace the headings on the phone', async () => {
		render(AdminDistilleryTable, props());

		await page.getByLabelText('Sortieren nach').selectOptions('cost');
		expect(order()).toEqual(['Bushmills', 'Zuidam', 'Ardbeg']);
		await page.getByRole('button', { name: 'Aufsteigend' }).click();
		expect(order()).toEqual(['Ardbeg', 'Zuidam', 'Bushmills']);
		await expect.element(page.getByRole('button', { name: 'Absteigend' })).toBeVisible();
	});

	test('edits a row inline, the region only for Scotland', async () => {
		render(AdminDistilleryTable, props());

		await page.getByRole('button', { name: 'Ardbeg bearbeiten' }).first().click();

		const form = page.getByRole('rowgroup').filter({ hasText: 'Ardbeg' });
		await expect.element(form.getByLabelText('Land', { exact: true })).toHaveValue('Schottland');
		await expect.element(form.getByLabelText('Region')).toHaveValue('Islay');
		await expect.element(form.getByLabelText('Region')).toBeEnabled();
		await expect.element(form.getByLabelText('Kapazität (l A/Jahr)')).toHaveValue('1400000');
		expect(page.getByRole('button', { name: 'Ardbeg bearbeiten' }).elements()).toHaveLength(0);

		await form.getByLabelText('Land', { exact: true }).fill('Irland');
		await expect.element(form.getByLabelText('Region')).toBeDisabled();

		await form.getByRole('button', { name: 'Abbrechen' }).click();
		expect(document.querySelector('form[action="?/updateDistillery"]')).toBeNull();
	});

	test('starts empty fields for values without one', async () => {
		render(AdminDistilleryTable, props());

		await page.getByRole('button', { name: 'Zuidam bearbeiten' }).first().click();

		const form = rowOf('Zuidam');
		await expect.element(form.getByLabelText('Land', { exact: true })).toHaveValue('');
		await expect.element(form.getByLabelText('Region')).toBeDisabled();
		await expect.element(form.getByLabelText('Kapazität (l A/Jahr)')).toHaveValue('');
		const key = document.querySelector<HTMLInputElement>('form input[name="key"]');
		expect(key?.value).toBe('zuidam');
	});

	test('closes the form after saving', async () => {
		render(AdminDistilleryTable, props());
		await page.getByRole('button', { name: 'Ardbeg bearbeiten' }).first().click();

		const update = await runSubmit({ type: 'success', status: 200 });

		expect(update).toHaveBeenCalledWith({ reset: false });
		await expect.poll(() => document.querySelector('form[action="?/updateDistillery"]')).toBeNull();
		expect(toast.toasts.map((t) => [t.variant, t.message])).toEqual([
			['success', 'Werte gespeichert.']
		]);
	});

	test('keeps the form with the field errors of a failed save', async () => {
		render(
			AdminDistilleryTable,
			props({ editErrors: { key: 'ardbeg', country: null, region: 'Ungültig', capacity: null } })
		);
		await page.getByRole('button', { name: 'Ardbeg bearbeiten' }).first().click();

		await runSubmit({ type: 'failure', status: 400 });

		await expect.element(rowOf('Ardbeg').getByText('Ungültig')).toBeVisible();
		expect(document.querySelector('form[action="?/updateDistillery"]')).not.toBeNull();
		expect(toast.toasts).toEqual([]);
	});

	test('says so while no tasting is revealed', async () => {
		render(AdminDistilleryTable, props({ distilleries: [], costMicroUsd: 0 }));

		await expect
			.element(page.getByText('Noch keine Destillerie aus einem aufgelösten Tasting.'))
			.toBeVisible();
		await expect.element(page.getByText('0,00 $')).toBeVisible();
		expect(document.querySelector('table')).toBeNull();
	});
});
