import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ConfirmDialog from './ConfirmDialog.svelte';
import { confirmDialog } from './confirmDialogStore.svelte';

beforeEach(() => {
	if (confirmDialog.request) confirmDialog.cancel();
});

describe('ConfirmDialog', () => {
	test('is absent from the accessibility tree until asked', async () => {
		render(ConfirmDialog);
		expect(page.getByRole('dialog').elements()).toHaveLength(0);
	});

	test('shows the message and default labels once asked', async () => {
		render(ConfirmDialog);
		confirmDialog.ask('Wirklich fortfahren?');

		const dialog = page.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog.getByText('Wirklich fortfahren?')).toBeVisible();
		await expect.element(dialog.getByRole('button', { name: 'Bestätigen' })).toBeVisible();
		await expect.element(dialog.getByRole('button', { name: 'Abbrechen' })).toBeVisible();

		confirmDialog.cancel();
	});

	test('resolves true and hides the dialog when confirmed', async () => {
		render(ConfirmDialog);
		const pending = confirmDialog.ask('Fortfahren?');

		await page.getByRole('dialog').getByRole('button', { name: 'Bestätigen' }).click();

		await expect(pending).resolves.toBe(true);
		expect(page.getByRole('dialog').elements()).toHaveLength(0);
	});

	test('resolves false when cancelled', async () => {
		render(ConfirmDialog);
		const pending = confirmDialog.ask('Fortfahren?');

		await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();

		await expect(pending).resolves.toBe(false);
	});

	test('resolves false on Escape', async () => {
		render(ConfirmDialog);
		const pending = confirmDialog.ask('Fortfahren?');
		await expect.element(page.getByRole('dialog')).toBeVisible();

		await userEvent.keyboard('{Escape}');

		await expect(pending).resolves.toBe(false);
		expect(page.getByRole('dialog').elements()).toHaveLength(0);
	});

	test('uses custom labels for the danger variant', async () => {
		render(ConfirmDialog);
		confirmDialog.ask('Wirklich löschen?', {
			confirmLabel: 'Löschen',
			cancelLabel: 'Nein',
			variant: 'danger'
		});

		const dialog = page.getByRole('dialog');
		await expect.element(dialog.getByRole('button', { name: 'Löschen' })).toBeVisible();
		await expect.element(dialog.getByRole('button', { name: 'Nein' })).toBeVisible();

		confirmDialog.cancel();
	});
});
