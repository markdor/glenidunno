import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { SubmitFunction } from '@sveltejs/kit';

// enhance is replaced so the submit callbacks can be driven directly – the
// real one would need a running SvelteKit client for update(). Kept per action.
const captured = vi.hoisted(() => ({ submit: {} as Record<string, SubmitFunction> }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
		captured.submit[form.getAttribute('action')!] = submit;
		return { destroy() {} };
	}
}));
// The configured origin of the app (ORIGIN) – not the test runner's.
vi.mock('$app/state', () => ({ page: { url: new URL('https://glenidunno.example/history') } }));

import ShareButton from './ShareButton.svelte';
import { confirmDialog } from './confirmDialogStore.svelte';
import { toast } from './toastStore.svelte';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';

const TOKEN = 'a'.repeat(43);
const NOT_SHARED = { bottleId: 'b1', token: null };
const SHARED = { bottleId: 'b1', token: TOKEN };

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
	captured.submit = {};
});

afterEach(() => {
	vi.unstubAllGlobals();
	if (confirmDialog.request) confirmDialog.cancel();
});

/** Runs the enhance callback of the form with this action like a response would. */
async function respond(action: string, result: Record<string, unknown>) {
	const update = vi.fn(async () => {});
	const formElement = document.querySelector<HTMLFormElement>(`form[action="${action}"]`)!;
	const after = await captured.submit[action]({
		formElement
	} as unknown as Parameters<SubmitFunction>[0]);
	await (after as (opts: unknown) => Promise<void>)({ result, update, formElement });
	return update;
}

async function open(name: string) {
	await page.getByRole('button', { name }).click();
	await expect.element(page.getByRole('dialog')).toBeVisible();
}

describe('ShareButton', () => {
	test('names the bottle and opens nothing until clicked', async () => {
		render(ShareButton, { share: NOT_SHARED, alias: 'Nebel' });
		await expect
			.element(page.getByRole('button', { name: 'Nebel teilen' }))
			.toHaveTextContent('Teilen');
		expect(page.getByRole('dialog').elements()).toHaveLength(0);
	});

	test('explains what a link shares before creating it', async () => {
		render(ShareButton, { share: NOT_SHARED, alias: 'Nebel' });
		await open('Nebel teilen');

		const dialog = page.getByRole('dialog', { name: '„Nebel“ teilen' });
		await expect.element(dialog).toHaveTextContent(/auch ohne Anmeldung/);
		await expect.element(dialog).toHaveTextContent(/zum PDF umgewandelte Präsentation/);
		await expect
			.element(dialog)
			.toHaveTextContent(/Wer die Flasche mitgebracht hat, steht nicht dabei/);
		await expect.element(dialog).toHaveTextContent(/jederzeit widerrufen/);
		const form = document.querySelector<HTMLFormElement>('form[action="?/share"]')!;
		expect(new FormData(form).get('bottleId')).toBe('b1');
		await expect
			.element(page.getByRole('button', { name: 'Link erzeugen' }))
			.toHaveAttribute('type', 'submit');
	});

	test('reports a created link and keeps the page’s form untouched on failure', async () => {
		render(ShareButton, { share: NOT_SHARED, alias: 'Nebel' });
		await open('Nebel teilen');

		const update = await respond('?/share', { type: 'success', data: { action: 'share' } });
		expect(update).toHaveBeenCalledWith({ reset: false });
		expect(toast.toasts.at(-1)).toMatchObject({ variant: 'success', message: 'Link erzeugt.' });

		const failed = await respond('?/share', {
			type: 'failure',
			status: 429,
			data: { userMessage: 'Zu viele Änderungen.' }
		});
		expect(failed).not.toHaveBeenCalled();
		expect(toast.toasts.at(-1)).toMatchObject({
			variant: 'error',
			message: 'Zu viele Änderungen.'
		});

		await respond('?/share', { type: 'failure', status: 500, data: {} });
		expect(toast.toasts.at(-1)).toMatchObject({ message: UNEXPECTED_ERROR_MESSAGE });
		await respond('?/share', { type: 'error', status: 500, error: new Error('x') });
		expect(toast.toasts.at(-1)).toMatchObject({ message: UNEXPECTED_ERROR_MESSAGE });
	});

	test('shows an existing link as an absolute URL to copy', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		render(ShareButton, { share: SHARED, alias: 'Nebel' });
		await expect
			.element(page.getByRole('button', { name: 'Geteilt: Link zu Nebel verwalten' }))
			.toHaveTextContent('Geteilt');
		await open('Geteilt: Link zu Nebel verwalten');

		const url = `https://glenidunno.example/share/${TOKEN}`;
		await expect.element(page.getByLabelText('Link zum Teilen')).toHaveValue(url);
		await page.getByRole('button', { name: 'Kopieren' }).click();
		expect(writeText).toHaveBeenCalledWith(url);
		expect(toast.toasts.at(-1)).toMatchObject({ variant: 'success', message: 'Link kopiert.' });
	});

	test('lets the user copy by hand without the clipboard API', async () => {
		vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
		render(ShareButton, { share: SHARED, alias: 'Nebel' });
		await open('Geteilt: Link zu Nebel verwalten');

		await page.getByRole('button', { name: 'Kopieren' }).click();
		expect(toast.toasts.at(-1)).toMatchObject({ variant: 'info' });
		const input = page.getByLabelText('Link zum Teilen').element() as HTMLInputElement;
		expect(input.selectionEnd! - input.selectionStart!).toBe(input.value.length);
	});

	describe('revoking', () => {
		let requestSubmit: MockInstance<HTMLFormElement['requestSubmit']>;

		beforeEach(() => {
			// Without the real enhance the browser would submit natively and navigate.
			requestSubmit = vi
				.spyOn(HTMLFormElement.prototype, 'requestSubmit')
				.mockImplementation(() => {});
		});

		afterEach(() => requestSubmit.mockRestore());

		test('asks first and submits the revoke form only when confirmed', async () => {
			render(ShareButton, { share: SHARED, alias: 'Nebel' });
			await open('Geteilt: Link zu Nebel verwalten');

			await page.getByRole('button', { name: 'Link widerrufen' }).click();
			expect(confirmDialog.request).toMatchObject({
				message: expect.stringContaining('„Nebel“ widerrufen'),
				variant: 'danger',
				confirmLabel: 'Widerrufen'
			});
			confirmDialog.cancel();
			await expect.poll(() => requestSubmit.mock.calls.length).toBe(0);

			await page.getByRole('button', { name: 'Link widerrufen' }).click();
			confirmDialog.confirm();
			await expect.poll(() => requestSubmit.mock.calls.length).toBe(1);
			const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
			expect(form.getAttribute('action')).toBe('?/unshare');
			expect(new FormData(form).get('bottleId')).toBe('b1');
		});

		test('reports the revoked link', async () => {
			render(ShareButton, { share: SHARED, alias: 'Nebel' });
			await open('Geteilt: Link zu Nebel verwalten');
			await respond('?/unshare', { type: 'success', data: { action: 'unshare' } });
			expect(toast.toasts.at(-1)).toMatchObject({
				variant: 'success',
				message: 'Link widerrufen.'
			});
		});
	});

	test('closes with its close button and with Escape', async () => {
		render(ShareButton, { share: NOT_SHARED, alias: 'Nebel' });
		await open('Nebel teilen');
		await page.getByRole('button', { name: 'Schließen' }).click();
		await expect.poll(() => document.querySelector('dialog')?.open).toBe(false);

		await open('Nebel teilen');
		document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
		await expect.poll(() => document.querySelector('dialog')?.open).toBe(false);
	});

	test('closes on a click on the backdrop, not inside', async () => {
		render(ShareButton, { share: NOT_SHARED, alias: 'Nebel' });
		await open('Nebel teilen');
		const dialog = document.querySelector('dialog')!;
		dialog.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(dialog.open).toBe(true);
		dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await expect.poll(() => dialog.open).toBe(false);
	});
});
