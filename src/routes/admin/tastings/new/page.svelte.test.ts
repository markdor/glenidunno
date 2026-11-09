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

	test('offers taste and facts as the pouring order, taste picked', async () => {
		render(Page, { data, form: null });

		const taste = page.getByRole('radio', { name: /Geschmack/ });
		const facts = page.getByRole('radio', { name: /Fakten/ });
		await expect.element(taste).toBeChecked();
		await expect.element(facts).not.toBeChecked();
		await expect.element(taste).toHaveAttribute('value', 'taste');
		await expect.element(facts).toHaveAttribute('value', 'facts');
		await expect.element(page.getByText('Etikett, Preis, Fass')).toBeVisible();
		await expect
			.element(page.getByText('Lässt sich nach dem Anlegen nicht mehr ändern.'))
			.toBeVisible();

		await facts.click();
		const form = facts.element().closest('form')!;
		expect(new FormData(form).get('algorithm')).toBe('facts');
	});

	test('keeps the picked algorithm after a failed submit and shows its error', async () => {
		render(Page, {
			data,
			form: {
				action: 'create',
				values: {
					motto: '',
					mottoDescription: '',
					tastingDate: '',
					participants: [],
					algorithm: 'facts'
				},
				fieldErrors: { algorithm: 'invalid' }
			}
		});
		await expect.element(page.getByRole('radio', { name: /Fakten/ })).toBeChecked();
		await expect.element(page.getByText('Ungültig')).toBeVisible();
	});

	test('offers an optional motto as the title, its description right below, and no name', async () => {
		render(Page, { data, form: null });

		const motto = page.getByLabelText('Motto', { exact: true });
		await expect.element(motto).toHaveAttribute('maxlength', '120');
		await expect.element(motto).not.toBeRequired();
		await expect.element(motto).toHaveValue('');
		await expect
			.element(motto)
			.toHaveAccessibleDescription(
				'Das Motto ist der Titel des Tastings. Ohne Motto heißt es nach seiner laufenden Nummer, z. B. „Tasting #18“.'
			);
		const description = page.getByLabelText('Erklärung');
		expect(description.element().tagName).toBe('TEXTAREA');
		await expect.element(description).toHaveAttribute('maxlength', '1000');
		await expect.element(description).toHaveAttribute('rows', '4');
		await expect.element(description).not.toBeRequired();
		await expect.element(description).toHaveValue('');
		const inputs = page.getByRole('textbox').elements();
		expect(inputs.indexOf(motto.element())).toBe(0);
		expect(inputs.indexOf(description.element())).toBe(1);
		expect(page.getByLabelText(/Name/).elements()).toHaveLength(0);
	});

	test('enables the description only once a heading is typed', async () => {
		render(Page, { data, form: null });
		const motto = page.getByLabelText('Motto', { exact: true });
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
					motto: 'Inselhüpfen',
					mottoDescription: 'Eine Insel pro Flasche.\nKeine Blends.',
					tastingDate: '2026-10-24',
					participants: ['u-anna', 'u-ben'],
					algorithm: ''
				},
				fieldErrors: { algorithm: 'invalid' }
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
					motto: 'x'.repeat(121),
					mottoDescription: 'y'.repeat(1001),
					tastingDate: '',
					participants: ['u-anna'],
					algorithm: ''
				},
				fieldErrors: {
					motto: 'invalid',
					mottoDescription: 'invalid',
					tastingDate: 'required',
					participants: 'invalid'
				}
			}
		});

		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
		expect(page.getByText('Ungültig').elements()).toHaveLength(3);
		await expect
			.element(page.getByLabelText('Motto', { exact: true }))
			.toHaveValue('x'.repeat(121));
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
					motto: '',
					mottoDescription: '',
					tastingDate: '',
					participants: [],
					algorithm: ''
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
