import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
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

	describe('submit()', () => {
		let requestSubmit: MockInstance<HTMLFormElement['requestSubmit']>;
		let container: HTMLDivElement;
		let form: HTMLFormElement;

		beforeEach(() => {
			if (confirmDialog.request) confirmDialog.cancel();
			// Nothing enhances the form here, a real submit would navigate.
			requestSubmit = vi
				.spyOn(HTMLFormElement.prototype, 'requestSubmit')
				.mockImplementation(() => {});
			container = document.createElement('div');
			form = document.createElement('form');
			container.append(form);
			document.body.append(container);
		});

		afterEach(() => {
			requestSubmit.mockRestore();
			container.remove();
		});

		// Clicks a new type="button" in `parent` whose listener calls submit()
		// like an onclick does. A throw inside a listener never reaches the
		// caller of click(), so the listener catches it – which also shows that
		// it happens synchronously.
		function clickButtonIn(
			parent: HTMLElement,
			message = 'Wirklich?',
			options?: Parameters<typeof confirmDialog.submit>[2]
		) {
			const button = document.createElement('button');
			button.type = 'button';
			parent.append(button);
			const click: { event?: Event; answered?: Promise<void>; error?: unknown } = {};
			button.addEventListener('click', (event) => {
				click.event = event;
				try {
					click.answered = confirmDialog.submit(event, message, options);
				} catch (error) {
					click.error = error;
				}
			});
			button.click();
			return click;
		}

		test("submits the button's form once confirmed after the click was dispatched", async () => {
			const { event, answered } = clickButtonIn(form);
			// The trap submit() avoids: currentTarget is gone before the answer.
			expect(event?.currentTarget).toBeNull();

			confirmDialog.confirm();
			await answered;

			expect(requestSubmit).toHaveBeenCalledOnce();
			expect(requestSubmit.mock.contexts[0]).toBe(form);
		});

		test('submits nothing when cancelled', async () => {
			const { answered } = clickButtonIn(form);

			confirmDialog.cancel();
			await answered;

			expect(requestSubmit).not.toHaveBeenCalled();
		});

		test('throws synchronously for a button outside a form, without asking', () => {
			const { error, answered } = clickButtonIn(container);

			expect(error).toBeInstanceOf(Error);
			expect(answered).toBeUndefined();
			expect(confirmDialog.request).toBeNull();
		});

		test('throws synchronously for an event without currentTarget, without asking', () => {
			// Never dispatched, so its currentTarget is null.
			expect(() => confirmDialog.submit(new MouseEvent('click'), 'Wirklich?')).toThrow(Error);
			expect(confirmDialog.request).toBeNull();
		});

		test('passes message and options to the dialog unchanged', () => {
			clickButtonIn(form, 'Tasting löschen?', {
				confirmLabel: 'Löschen',
				cancelLabel: 'Behalten',
				variant: 'danger'
			});

			expect(confirmDialog.request).toMatchObject({
				message: 'Tasting löschen?',
				confirmLabel: 'Löschen',
				cancelLabel: 'Behalten',
				variant: 'danger'
			});

			confirmDialog.cancel();
		});
	});
});
