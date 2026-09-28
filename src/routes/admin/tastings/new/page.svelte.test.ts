import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { toast } from '$lib/components/toastStore.svelte';

const data = { user: { id: 'admin-id', username: 'admin', isAdmin: true }, today: '2026-10-21' };

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('New tasting page', () => {
	test('starts with three participant fields and two bottles per person', async () => {
		render(Page, { data, form: null });

		await expect.element(page.getByLabelText('Datum *')).toHaveAttribute('min', '2026-10-21');
		await expect.element(page.getByLabelText('Flaschen pro Person *')).toHaveValue(2);
		expect(page.getByRole('textbox', { name: /^Teilnehmer \d+$/ }).elements()).toHaveLength(3);
	});

	test('adds participant fields on demand', async () => {
		render(Page, { data, form: null });

		await page.getByRole('button', { name: 'Teilnehmer hinzufügen' }).click();

		expect(page.getByRole('textbox', { name: /^Teilnehmer \d+$/ }).elements()).toHaveLength(4);
	});

	test('keeps the sent values and shows the field errors', async () => {
		render(Page, {
			data,
			form: {
				action: 'create',
				values: {
					name: '',
					tastingDate: '2026-10-01',
					bottlesPerParticipant: '2',
					participants: ['Anna', 'Ben', 'Cem', 'Dora']
				},
				fieldErrors: { name: 'required', tastingDate: 'invalid', participants: 'invalid' }
			}
		});

		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
		expect(page.getByText('Ungültig').elements()).toHaveLength(2);
		await expect.element(page.getByLabelText('Teilnehmer 4')).toHaveValue('Dora');
	});

	test('shows the new links once, with a way to the tasting', async () => {
		render(Page, {
			data,
			form: {
				action: 'create',
				created: {
					tastingId: 't1',
					links: [{ name: 'Anna', url: 'https://glenidunno.test/tasting/' + 'a'.repeat(32) }]
				}
			}
		});

		await expect.element(page.getByRole('heading', { name: 'Tasting angelegt' })).toBeVisible();
		await expect
			.element(page.getByText('https://glenidunno.test/tasting/' + 'a'.repeat(32)))
			.toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Zum Tasting' }))
			.toHaveAttribute('href', '/admin/tastings/t1');
		expect(page.getByRole('button', { name: 'Tasting anlegen' }).elements()).toHaveLength(0);
	});

	test('reports a general failure as a toast', async () => {
		render(Page, { data, form: { action: 'create', userMessage: 'Da ist etwas schiefgelaufen.' } });
		expect(
			toast.toasts.some(
				(t) => t.variant === 'error' && t.message === 'Da ist etwas schiefgelaufen.'
			)
		).toBe(true);
	});
});
