import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { toast } from '$lib/components/toastStore.svelte';

const data = {
	user: { id: 'admin-id', username: 'admin', isAdmin: true },
	today: '2026-10-21',
	users: [
		{ id: 'admin-id', username: 'admin' },
		{ id: 'u-anna', username: 'Anna' },
		{ id: 'u-ben', username: 'Ben' }
	]
};

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('New tasting page', () => {
	test('offers every active user as a checkbox, none ticked, and no number of bottles', async () => {
		render(Page, { data, form: null });

		await expect.element(page.getByLabelText('Datum *')).toHaveAttribute('min', '2026-10-21');
		// The participants add their bottles themselves.
		expect(page.getByLabelText(/Flaschen/).elements()).toHaveLength(0);
		const boxes = page.getByRole('checkbox');
		expect(boxes.elements()).toHaveLength(3);
		for (const box of boxes.elements()) expect((box as HTMLInputElement).checked).toBe(false);
		await expect
			.element(page.getByRole('checkbox', { name: 'Anna' }))
			.toHaveAttribute('value', 'u-anna');
		await expect
			.element(page.getByRole('link', { name: 'Admin' }))
			.toHaveAttribute('href', '/admin');
	});

	test('offers an optional motto heading and description right below the name', async () => {
		render(Page, { data, form: null });

		const motto = page.getByLabelText('Motto (Überschrift)');
		await expect.element(motto).toHaveAttribute('maxlength', '120');
		await expect.element(motto).not.toBeRequired();
		await expect.element(motto).toHaveValue('');
		const description = page.getByLabelText('Erklärung');
		expect(description.element().tagName).toBe('TEXTAREA');
		await expect.element(description).toHaveAttribute('maxlength', '1000');
		await expect.element(description).toHaveAttribute('rows', '4');
		await expect.element(description).not.toBeRequired();
		await expect.element(description).toHaveValue('');
		const inputs = page.getByRole('textbox').elements();
		const name = inputs.indexOf(page.getByLabelText('Name *').element());
		expect(inputs.indexOf(motto.element())).toBe(name + 1);
		expect(inputs.indexOf(description.element())).toBe(name + 2);
	});

	test('enables the description only once a heading is typed', async () => {
		render(Page, { data, form: null });
		const motto = page.getByLabelText('Motto (Überschrift)');
		const description = page.getByLabelText('Erklärung');
		await expect.element(description).toBeDisabled();

		await motto.fill('   ');
		await expect.element(description).toBeDisabled();
		await motto.fill('Inselhüpfen');
		await expect.element(description).toBeEnabled();
		await description.fill('Eine Insel pro Flasche.');

		// Without a heading the description isn't sent, but stays for a new one.
		await motto.fill('');
		await expect.element(description).toBeDisabled();
		await expect.element(description).toHaveValue('Eine Insel pro Flasche.');
		const form = description.element().closest('form')!;
		expect(new FormData(form).has('mottoDescription')).toBe(false);
	});

	test('keeps the description enabled for a sent heading', async () => {
		render(Page, {
			data,
			form: {
				action: 'create',
				values: {
					name: '',
					motto: 'Inselhüpfen',
					mottoDescription: 'Eine Insel pro Flasche.\nKeine Blends.',
					tastingDate: '2026-10-24',
					participants: ['u-anna', 'u-ben']
				},
				fieldErrors: { name: 'required' }
			}
		});

		const description = page.getByLabelText('Erklärung');
		await expect.element(description).toBeEnabled();
		await expect.element(description).toHaveValue('Eine Insel pro Flasche.\nKeine Blends.');
	});

	test('ticks a user by tapping the whole row', async () => {
		render(Page, { data, form: null });

		await page.getByText('Ben').click();

		await expect.element(page.getByRole('checkbox', { name: 'Ben' })).toBeChecked();
	});

	test('keeps the sent values and shows the field errors', async () => {
		render(Page, {
			data,
			form: {
				action: 'create',
				values: {
					name: '',
					motto: 'x'.repeat(121),
					mottoDescription: 'y'.repeat(1001),
					tastingDate: '2026-10-01',
					participants: ['u-anna']
				},
				fieldErrors: {
					name: 'required',
					motto: 'invalid',
					mottoDescription: 'invalid',
					tastingDate: 'invalid',
					participants: 'invalid'
				}
			}
		});

		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
		expect(page.getByText('Ungültig').elements()).toHaveLength(4);
		await expect.element(page.getByLabelText('Motto (Überschrift)')).toHaveValue('x'.repeat(121));
		await expect.element(page.getByLabelText('Erklärung')).toHaveValue('y'.repeat(1001));
		await expect.element(page.getByRole('checkbox', { name: 'Anna' })).toBeChecked();
		await expect.element(page.getByRole('checkbox', { name: 'Ben' })).not.toBeChecked();
	});

	test('shows no tasting link', async () => {
		render(Page, { data, form: null });
		expect(page.getByText(/\/tasting\//).elements()).toHaveLength(0);
	});

	test('reports a general failure as a toast', async () => {
		render(Page, {
			data,
			form: {
				action: 'create',
				values: {
					name: 'Herbst',
					motto: '',
					mottoDescription: '',
					tastingDate: '',
					participants: []
				},
				userMessage: 'Da ist etwas schiefgelaufen.'
			}
		});
		expect(
			toast.toasts.some(
				(t) => t.variant === 'error' && t.message === 'Da ist etwas schiefgelaufen.'
			)
		).toBe(true);
	});
});
