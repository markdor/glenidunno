import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
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

import ResearchPromptEditor from './ResearchPromptEditor.svelte';
import { confirmDialog } from './confirmDialogStore.svelte';
import { toast } from './toastStore.svelte';

const RULES = 'Land\n- Auf Deutsch.';

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
	captured.submit = {};
});

async function runSubmit(action: string, result: Record<string, unknown>) {
	const update = vi.fn(async () => {});
	const formElement = document.querySelector<HTMLFormElement>(`form[action="${action}"]`)!;
	const after = await captured.submit[action]({
		formElement
	} as unknown as Parameters<SubmitFunction>[0]);
	await (after as (opts: unknown) => Promise<void>)({ result, update, formElement });
	return update;
}

async function open() {
	await page.getByText('Recherche-Prompt').click();
}

describe('ResearchPromptEditor', () => {
	test('shows the rules read-only once opened', async () => {
		render(ResearchPromptEditor, { prompt: { text: RULES, custom: false } });

		await open();

		await expect.element(page.getByText('- Auf Deutsch.')).toBeVisible();
		expect(page.getByRole('textbox').elements()).toHaveLength(0);
		expect(page.getByText('Angepasst').elements()).toHaveLength(0);
		await expect.element(page.getByText(/Bearbeitbar sind nur die Fachregeln/)).toBeVisible();
	});

	test('marks a prompt that differs from the default', async () => {
		render(ResearchPromptEditor, { prompt: { text: RULES, custom: true } });

		await expect.element(page.getByText('Angepasst')).toBeVisible();
		await open();
		await expect.element(page.getByText(/weicht vom Standard ab/)).toBeVisible();
	});

	test('edits the rules in a text field and cancels', async () => {
		render(ResearchPromptEditor, { prompt: { text: RULES, custom: false } });
		await open();

		await page.getByRole('button', { name: 'Bearbeiten' }).click();
		const field = page.getByRole('textbox', { name: 'Recherche-Prompt' });
		await expect.element(field).toHaveValue(RULES);
		// Nothing to reset without a deviation.
		expect(page.getByRole('button', { name: 'Auf Standard zurücksetzen' }).elements()).toHaveLength(
			0
		);

		await field.fill('Neue Regeln');
		await page.getByRole('button', { name: 'Abbrechen' }).click();
		expect(page.getByRole('textbox').elements()).toHaveLength(0);
	});

	test('saves and goes back to reading', async () => {
		render(ResearchPromptEditor, { prompt: { text: RULES, custom: false } });
		await open();
		await page.getByRole('button', { name: 'Bearbeiten' }).click();

		const update = await runSubmit('?/saveResearchPrompt', { type: 'success', status: 200 });

		expect(update).toHaveBeenCalledWith({ reset: false });
		await expect.poll(() => page.getByRole('textbox').elements()).toHaveLength(0);
		expect(toast.toasts.map((t) => [t.variant, t.message])).toEqual([
			['success', 'Recherche-Prompt gespeichert.']
		]);
	});

	test('keeps the text field and shows the error of a failed save', async () => {
		render(ResearchPromptEditor, { prompt: { text: RULES, custom: false }, error: 'Zu lang' });
		await open();
		await page.getByRole('button', { name: 'Bearbeiten' }).click();

		await runSubmit('?/saveResearchPrompt', { type: 'failure', status: 400 });

		await expect.element(page.getByRole('textbox', { name: 'Recherche-Prompt' })).toBeVisible();
		await expect.element(page.getByText('Zu lang')).toBeVisible();
		expect(toast.toasts).toEqual([]);
	});

	describe('reset', () => {
		let requestSubmit: MockInstance<HTMLFormElement['requestSubmit']>;
		const ticks = () => new Promise((resolve) => setTimeout(resolve));

		beforeEach(() => {
			// The mocked enhance doesn't catch the submit, a real one would navigate.
			requestSubmit = vi
				.spyOn(HTMLFormElement.prototype, 'requestSubmit')
				.mockImplementation(() => {});
		});

		afterEach(() => {
			requestSubmit.mockRestore();
			if (confirmDialog.request) confirmDialog.cancel();
		});

		test('asks before going back to the default and sends the reset form', async () => {
			render(ResearchPromptEditor, { prompt: { text: RULES, custom: true } });
			await open();
			await page.getByRole('button', { name: 'Bearbeiten' }).click();

			await page.getByRole('button', { name: 'Auf Standard zurücksetzen' }).click();
			expect(confirmDialog.request).toMatchObject({
				message: expect.stringContaining('auf den Standard zurücksetzen'),
				confirmLabel: 'Zurücksetzen'
			});
			confirmDialog.confirm();
			await ticks();

			expect(requestSubmit).toHaveBeenCalledOnce();
			expect(requestSubmit.mock.contexts[0]).toBe(
				document.querySelector('form[action="?/resetResearchPrompt"]')
			);

			await runSubmit('?/resetResearchPrompt', { type: 'success', status: 200 });
			await expect.poll(() => page.getByRole('textbox').elements()).toHaveLength(0);
			expect(toast.toasts.map((t) => t.message)).toEqual(['Recherche-Prompt zurückgesetzt.']);
		});

		test('sends nothing when the dialog is dismissed', async () => {
			render(ResearchPromptEditor, { prompt: { text: RULES, custom: true } });
			await open();
			await page.getByRole('button', { name: 'Bearbeiten' }).click();

			await page.getByRole('button', { name: 'Auf Standard zurücksetzen' }).click();
			confirmDialog.cancel();
			await ticks();

			expect(requestSubmit).not.toHaveBeenCalled();
		});
	});
});
