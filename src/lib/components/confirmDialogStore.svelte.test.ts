import { describe, test, expect } from 'vitest';
import { confirmDialog } from './confirmDialogStore.svelte';

describe('confirmDialog store', () => {
	test('ask() resolves true once confirm() is called', async () => {
		const pending = confirmDialog.ask('Wirklich?');
		expect(confirmDialog.request?.message).toBe('Wirklich?');

		confirmDialog.confirm();

		await expect(pending).resolves.toBe(true);
		expect(confirmDialog.request).toBeNull();
	});

	test('ask() resolves false once cancel() is called', async () => {
		const pending = confirmDialog.ask('Wirklich?');

		confirmDialog.cancel();

		await expect(pending).resolves.toBe(false);
		expect(confirmDialog.request).toBeNull();
	});

	test('defaults labels and variant when none are given', () => {
		confirmDialog.ask('Frage ohne Optionen');

		expect(confirmDialog.request?.confirmLabel).toBe('Bestätigen');
		expect(confirmDialog.request?.cancelLabel).toBe('Abbrechen');
		expect(confirmDialog.request?.variant).toBe('default');

		confirmDialog.cancel();
	});

	test('uses the given labels and variant', () => {
		confirmDialog.ask('Löschen?', {
			confirmLabel: 'Löschen',
			cancelLabel: 'Nein',
			variant: 'danger'
		});

		expect(confirmDialog.request?.confirmLabel).toBe('Löschen');
		expect(confirmDialog.request?.cancelLabel).toBe('Nein');
		expect(confirmDialog.request?.variant).toBe('danger');

		confirmDialog.cancel();
	});
});
