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
	test('offers every active user as a checkbox, none ticked, and two bottles per person', async () => {
		render(Page, { data, form: null });

		await expect.element(page.getByLabelText('Datum *')).toHaveAttribute('min', '2026-10-21');
		await expect.element(page.getByLabelText('Flaschen pro Person *')).toHaveValue(2);
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

	test('offers an optional motto right below the name', async () => {
		render(Page, { data, form: null });

		const motto = page.getByLabelText('Motto');
		await expect.element(motto).toHaveAttribute('maxlength', '120');
		await expect.element(motto).not.toBeRequired();
		await expect.element(motto).toHaveValue('');
		const inputs = page.getByRole('textbox').elements();
		expect(inputs.indexOf(motto.element())).toBe(
			inputs.indexOf(page.getByLabelText('Name *').element()) + 1
		);
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
					tastingDate: '2026-10-01',
					bottlesPerParticipant: '2',
					participants: ['u-anna']
				},
				fieldErrors: {
					name: 'required',
					motto: 'invalid',
					tastingDate: 'invalid',
					participants: 'invalid'
				}
			}
		});

		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
		expect(page.getByText('Ungültig').elements()).toHaveLength(3);
		await expect.element(page.getByLabelText('Motto')).toHaveValue('x'.repeat(121));
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
					tastingDate: '',
					bottlesPerParticipant: '2',
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
