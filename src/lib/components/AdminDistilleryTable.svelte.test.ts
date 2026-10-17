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
import { confirmDialog } from './confirmDialogStore.svelte';
import { toast } from './toastStore.svelte';
import type { AdminDistillery, DistilleryVariantSuggestion } from '$lib/tasting';
import { TASTING_BOTTLING_LENGTH } from '$lib/validation';

const WHISKYPEDIA = 'https://scotchwhisky.com/whiskypedia/1/ardbeg/';

const ardbeg: AdminDistillery = {
	key: 'ardbeg',
	name: 'Ardbeg',
	country: { value: 'Schottland', state: 'found', source: WHISKYPEDIA },
	region: { value: 'Islay', state: 'admin', source: null },
	capacity: { value: 1_400_000, state: 'found', source: 'javascript:alert(1)' },
	costMicroUsd: 523_000,
	bottles: [{ age: 10, bottling: null, bottler: null }]
};
const bushmills: AdminDistillery = {
	key: 'bushmills',
	name: 'Bushmills',
	country: { value: 'Nordirland', state: 'admin', source: null },
	region: null,
	capacity: { value: null, state: 'empty', source: null },
	costMicroUsd: 0,
	bottles: []
};
const zuidam: AdminDistillery = {
	key: 'zuidam',
	name: 'Zuidam',
	country: { value: null, state: 'pending', source: null },
	region: null,
	capacity: { value: null, state: 'pending', source: null },
	costMicroUsd: 81_000,
	bottles: []
};
const stoisha: AdminDistillery = {
	key: 'stoisha',
	name: 'Stoisha',
	country: { value: null, state: 'pending', source: null },
	region: null,
	capacity: { value: null, state: 'pending', source: null },
	costMicroUsd: 0,
	bottles: [
		{ age: 12, bottling: null, bottler: null },
		{ age: null, bottling: 'Edition', bottler: 'Signatory' }
	]
};
const suggestion: DistilleryVariantSuggestion = {
	id: 7,
	variantKey: 'stoisha',
	variantName: 'Stoisha',
	targetName: 'Ardbeg',
	kind: 'brand',
	prefix: 'Stoisha',
	bottles: 2
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
	if (confirmDialog.request) confirmDialog.cancel();
	vi.restoreAllMocks();
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

// The edit form keeps the submit callback it got for its first action
// (updateDistillery), also once a new name points it to renameDistillery.
async function runSubmit(result: Record<string, unknown>, action = '?/updateDistillery') {
	const update = vi.fn(async () => {});
	const formElement = document.querySelector<HTMLFormElement>('form')!;
	const after = await captured.submit[action]({
		formElement
	} as unknown as Parameters<SubmitFunction>[0]);
	await (after as (opts: unknown) => Promise<void>)({ result, update, formElement });
	return update;
}

function editForm() {
	return document.querySelector<HTMLFormElement>('form:has(input[name="name"])');
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
			props({
				editErrors: {
					key: 'ardbeg',
					country: null,
					region: 'Ungültig',
					capacity: null,
					name: null,
					prefix: null
				}
			})
		);
		await page.getByRole('button', { name: 'Ardbeg bearbeiten' }).first().click();

		await runSubmit({ type: 'failure', status: 400 });

		await expect.element(rowOf('Ardbeg').getByText('Ungültig')).toBeVisible();
		expect(document.querySelector('form[action="?/updateDistillery"]')).not.toBeNull();
		expect(toast.toasts).toEqual([]);
	});

	test('saves the values unchanged under the name of the table, with the name offered from the table', async () => {
		render(AdminDistilleryTable, props());
		await page.getByRole('button', { name: 'Ardbeg bearbeiten' }).first().click();

		const name = rowOf('Ardbeg').getByLabelText('Name', { exact: true });
		await expect.element(name).toHaveValue('Ardbeg');
		await expect.element(name).toHaveAttribute('list', 'distillery-name-options');
		expect(
			[...document.querySelectorAll('#distillery-name-options option')].map(
				(o) => (o as HTMLOptionElement).value
			)
		).toEqual(['Zuidam', 'Bushmills', 'Ardbeg']);
		await expect
			.element(rowOf('Ardbeg').getByLabelText('Alten Namen als Marke in die Abfüllung übernehmen'))
			.not.toBeChecked();
		expect(rowOf('Ardbeg').getByLabelText('Präfix der Abfüllung').elements()).toHaveLength(0);
		expect(editForm()?.getAttribute('action')).toBe('?/updateDistillery');
		await expect
			.element(rowOf('Ardbeg').getByRole('button', { name: 'Speichern' }))
			.toHaveAttribute('type', 'submit');
	});

	test('merges only after confirmation, with the new bottle names of the brand prefix', async () => {
		const requestSubmit = vi
			.spyOn(HTMLFormElement.prototype, 'requestSubmit')
			.mockImplementation(() => {});
		render(AdminDistilleryTable, props({ distilleries: [stoisha, ardbeg] }));
		await page.getByRole('button', { name: 'Stoisha bearbeiten' }).first().click();

		const row = rowOf('Stoisha');
		await row.getByLabelText('Name', { exact: true }).fill('ARDBEG');
		await row.getByLabelText('Alten Namen als Marke in die Abfüllung übernehmen').click();
		await expect.element(row.getByLabelText('Präfix der Abfüllung')).toHaveValue('Stoisha');
		expect(editForm()?.getAttribute('action')).toBe('?/renameDistillery');
		await row.getByRole('button', { name: 'Speichern' }).click();

		expect(confirmDialog.request).toMatchObject({
			message:
				'„Stoisha“ wird mit „Ardbeg“ zusammengeführt (2 Flaschen). „Ardbeg“ behält seine Werte und übernimmt nur fehlende. Das lässt sich nicht rückgängig machen. Die Flaschen heißen danach:',
			details: ['ARDBEG 12 Jahre Stoisha', 'ARDBEG Stoisha Edition (Signatory)'],
			confirmLabel: 'Zusammenführen',
			variant: 'danger'
		});
		expect(requestSubmit).not.toHaveBeenCalled();
		confirmDialog.confirm();
		await expect.poll(() => requestSubmit.mock.instances.length).toBe(1);
		expect(requestSubmit.mock.instances[0]).toBe(editForm());

		await runSubmit({
			type: 'success',
			status: 200,
			data: { action: 'renameDistillery', renamed: 'merged', bottles: 2 }
		});
		await expect.poll(() => editForm()).toBeNull();
		expect(toast.toasts.map((t) => [t.variant, t.message])).toEqual([
			['success', 'Destillerien zusammengeführt (2 Flaschen).']
		]);
	});

	test('renames into a new name without bottle list', async () => {
		render(AdminDistilleryTable, props({ distilleries: [stoisha, ardbeg] }));
		await page.getByRole('button', { name: 'Stoisha bearbeiten' }).first().click();

		await rowOf('Stoisha').getByLabelText('Name', { exact: true }).fill('Stoisha Distillery');
		await rowOf('Stoisha').getByRole('button', { name: 'Speichern' }).click();

		expect(confirmDialog.request).toMatchObject({
			message:
				'„Stoisha“ wird in „Stoisha Distillery“ umbenannt (2 Flaschen). Das lässt sich nicht rückgängig machen.',
			details: [],
			confirmLabel: 'Umbenennen'
		});
	});

	test('asks nothing for an empty name or a bottling that would get too long', async () => {
		render(AdminDistilleryTable, props({ distilleries: [stoisha, ardbeg] }));
		await page.getByRole('button', { name: 'Stoisha bearbeiten' }).first().click();
		const row = rowOf('Stoisha');

		await row.getByLabelText('Name', { exact: true }).fill('');
		await row.getByRole('button', { name: 'Speichern' }).click();
		expect(confirmDialog.request).toBeNull();

		await row.getByLabelText('Name', { exact: true }).fill('Ardbeg');
		await row.getByLabelText('Alten Namen als Marke in die Abfüllung übernehmen').click();
		await row
			.getByLabelText('Präfix der Abfüllung')
			.fill('x'.repeat(TASTING_BOTTLING_LENGTH.max - 'Edition'.length));
		await expect.element(row.getByText(/würde eine Abfüllung länger als/)).toBeVisible();
		await row.getByRole('button', { name: 'Speichern' }).click();
		expect(confirmDialog.request).toBeNull();
	});

	test('shows the field errors of a failed rename', async () => {
		render(
			AdminDistilleryTable,
			props({
				distilleries: [stoisha, ardbeg],
				editErrors: {
					key: 'stoisha',
					country: null,
					region: null,
					capacity: null,
					name: 'Pflichtfeld',
					prefix: 'Zu lang für die Abfüllung'
				}
			})
		);
		await page.getByRole('button', { name: 'Stoisha bearbeiten' }).first().click();
		await rowOf('Stoisha')
			.getByLabelText('Alten Namen als Marke in die Abfüllung übernehmen')
			.click();

		await expect.element(rowOf('Stoisha').getByText('Pflichtfeld')).toBeVisible();
		await expect.element(rowOf('Stoisha').getByText('Zu lang für die Abfüllung')).toBeVisible();
	});

	test('lists the open suggestions and takes one into the edit of its variant', async () => {
		render(
			AdminDistilleryTable,
			props({ distilleries: [stoisha, ardbeg], suggestions: [suggestion] })
		);

		const list = page.getByRole('list', { name: 'Vorschläge' });
		await expect.element(list.getByText('Stoisha → Ardbeg')).toBeVisible();
		await expect.element(list.getByText(/Marke · Präfix „Stoisha“ · 2 Flaschen/)).toBeVisible();

		await list.getByRole('button', { name: 'Stoisha → Ardbeg übernehmen' }).click();

		const row = rowOf('Stoisha');
		await expect.element(row.getByLabelText('Name', { exact: true })).toHaveValue('Ardbeg');
		await expect.element(row.getByLabelText('Name', { exact: true })).toHaveFocus();
		await expect
			.element(row.getByLabelText('Alten Namen als Marke in die Abfüllung übernehmen'))
			.toBeChecked();
		await expect.element(row.getByLabelText('Präfix der Abfüllung')).toHaveValue('Stoisha');
	});

	test('takes a spelling variant without prefix and rejects a suggestion', async () => {
		const spelling = { ...suggestion, kind: 'spelling' as const, prefix: null, bottles: 1 };
		render(
			AdminDistilleryTable,
			props({ distilleries: [stoisha, ardbeg], suggestions: [spelling] })
		);

		await expect.element(page.getByText(/Schreibvariante · 1 Flasche/)).toBeVisible();
		await page.getByRole('button', { name: 'Stoisha → Ardbeg übernehmen' }).click();
		await expect
			.element(rowOf('Stoisha').getByLabelText('Alten Namen als Marke in die Abfüllung übernehmen'))
			.not.toBeChecked();

		await expect
			.element(page.getByRole('button', { name: 'Stoisha → Ardbeg verwerfen' }))
			.toHaveAttribute('type', 'submit');
		const id = document.querySelector<HTMLInputElement>(
			'form[action="?/rejectVariant"] input[name="id"]'
		);
		expect(id?.value).toBe('7');
		await runSubmit({ type: 'success', status: 200 }, '?/rejectVariant');
		expect(toast.toasts.map((t) => t.message)).toEqual(['Vorschlag verworfen.']);
	});

	test('has no list without open suggestions', async () => {
		render(AdminDistilleryTable, props());
		await expect.element(page.getByRole('button', { name: 'Varianten suchen' })).toBeEnabled();
		expect(page.getByRole('list', { name: 'Vorschläge' }).elements()).toHaveLength(0);
	});

	test('keeps the search button off while a search runs', async () => {
		render(AdminDistilleryTable, props());
		const update = vi.fn(async () => {});
		const after = await captured.submit['?/suggestVariants']({} as Parameters<SubmitFunction>[0]);

		await expect.element(page.getByRole('button', { name: 'Suche läuft …' })).toBeDisabled();
		await (after as (opts: unknown) => Promise<void>)({
			result: { type: 'success', status: 200, data: { added: 2 } },
			update
		});
		await expect.element(page.getByRole('button', { name: 'Varianten suchen' })).toBeEnabled();
		expect(toast.toasts.map((t) => [t.variant, t.message])).toEqual([
			['success', '2 neue Vorschläge.']
		]);

		const again = await captured.submit['?/suggestVariants']({} as Parameters<SubmitFunction>[0]);
		await (again as (opts: unknown) => Promise<void>)({
			result: { type: 'success', status: 200, data: { added: 0 } },
			update
		});
		expect(toast.toasts.at(-1)).toMatchObject({
			variant: 'info',
			message: 'Keine neuen Vorschläge.'
		});

		// A failure: the page shows its message, the button is on again.
		const failed = await captured.submit['?/suggestVariants']({} as Parameters<SubmitFunction>[0]);
		await (failed as (opts: unknown) => Promise<void>)({
			result: { type: 'failure', status: 503 },
			update
		});
		await expect.element(page.getByRole('button', { name: 'Varianten suchen' })).toBeEnabled();
		expect(toast.toasts).toHaveLength(2);
	});

	test('keeps the search button off for a search from before a reload', async () => {
		render(AdminDistilleryTable, props({ searchRunning: true }));
		await expect.element(page.getByRole('button', { name: 'Suche läuft …' })).toBeDisabled();
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
