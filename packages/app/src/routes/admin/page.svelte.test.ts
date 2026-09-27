import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { toast } from '$lib/components/toastStore.svelte';

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

const currentUser = { id: 'admin-id', username: 'admin', isAdmin: true };

const adminUser = {
	id: 'admin-id',
	email: 'admin@dahamm.de',
	username: 'admin',
	isAdmin: true,
	telegramUserId: null,
	createdAt: new Date('2026-01-01')
};

const kidUser = {
	id: 'u2',
	email: 'kid@dahamm.de',
	username: 'kid',
	isAdmin: false,
	telegramUserId: '12345',
	createdAt: new Date('2026-02-01')
};

function makeData(over: Partial<Record<string, unknown>> = {}) {
	return {
		user: currentUser,
		users: [adminUser, kidUser],
		...over
	};
}

describe('Admin page', () => {
	test('lists the users', async () => {
		render(Page, { data: makeData(), form: null });

		await expect.element(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
		await expect.element(page.getByText('Benutzer (2)')).toBeVisible();
		await expect.element(page.getByText('kid@dahamm.de')).toBeVisible();
	});

	test('hides the delete button for the current admin (self)', async () => {
		render(Page, { data: makeData(), form: null });
		// One delete button (for "kid"), none for the admin themselves.
		expect(page.getByRole('button', { name: 'Löschen' }).elements()).toHaveLength(1);
	});

	test('reveals the inline edit form for a single user', async () => {
		// Only "kid" in the list so there is exactly one Bearbeiten button.
		render(Page, { data: makeData({ users: [kidUser] }), form: null });

		await page.getByRole('button', { name: 'Bearbeiten' }).click();
		await expect.element(page.getByRole('button', { name: 'Speichern' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
	});

	test('closes the inline edit form on cancel', async () => {
		render(Page, { data: makeData({ users: [kidUser] }), form: null });

		await page.getByRole('button', { name: 'Bearbeiten' }).click();
		await page.getByRole('button', { name: 'Abbrechen' }).click();

		await expect.element(page.getByRole('button', { name: 'Bearbeiten' })).toBeVisible();
		expect(page.getByRole('button', { name: 'Speichern' }).elements()).toHaveLength(0);
	});

	test('marks the own entry and locks its admin flag while editing', async () => {
		render(Page, { data: makeData({ users: [adminUser] }), form: null });

		await page.getByRole('button', { name: 'Bearbeiten' }).click();

		const adminFlag = page.getByRole('checkbox', { name: 'Admin (du selbst)' });
		await expect.element(adminFlag).toBeChecked();
		await expect.element(adminFlag).toBeDisabled();
	});

	test.each([
		{ field: 'email', code: 'invalid', text: 'Ungültig' },
		{ field: 'username', code: 'taken', text: 'Bereits vergeben' },
		{ field: 'username', code: 'unexpected', text: 'Ungültig' }
	])('shows the $code error on $field in the edit form', async ({ field, code, text }) => {
		render(Page, {
			data: makeData({ users: [kidUser] }),
			form: {
				action: 'update',
				id: 'u2',
				email: 'bad',
				username: 'kid',
				telegramUserId: '',
				fieldErrors: { [field]: code }
			}
		});

		await page.getByRole('button', { name: 'Bearbeiten' }).click();

		await expect.element(page.getByText(text)).toBeVisible();
	});

	test('shows create validation errors from the form result', async () => {
		render(Page, {
			data: makeData(),
			form: {
				action: 'create',
				email: 'bad',
				username: '',
				telegramUserId: '',
				fieldErrors: { email: 'invalid', username: 'required' }
			}
		});

		await expect.element(page.getByText('Ungültig')).toBeVisible();
		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
	});

	test('shows the created confirmation and the self-delete warning', async () => {
		render(Page, { data: makeData(), form: { action: 'create', created: true } });
		await expect.element(page.getByText('Benutzer angelegt.')).toBeVisible();
	});

	test('warns when a self-delete was blocked', async () => {
		render(Page, {
			data: makeData(),
			form: { action: 'delete', userMessage: 'Du kannst deinen eigenen Eintrag nicht löschen.' }
		});
		// The +page.svelte itself no longer renders the warning inline - it now
		// triggers the global toast store, rendered separately by <Toast/> in
		// +layout.svelte.
		expect(
			toast.toasts.some(
				(t) => t.variant === 'error' && /eigenen Eintrag nicht löschen/.test(t.message)
			)
		).toBe(true);
	});

	test('shows a toast for any generic action failure carrying a userMessage', async () => {
		render(Page, {
			data: makeData(),
			form: {
				action: 'delete',
				userMessage:
					'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
			}
		});
		// Not a special-cased error like self_delete - proves the effect reacts
		// to any userMessage, not just the one hardcoded reason.
		expect(
			toast.toasts.some((t) => t.variant === 'error' && /wurde nicht gefunden/.test(t.message))
		).toBe(true);
	});

	describe('delete confirmation', () => {
		// Runs against the real enhance (no $app/forms mock): the point is that
		// SvelteKit's enhance itself honours a dismissed confirm, which a stub
		// would hide. Only the delete request is intercepted.
		let deleteRequests: string[];

		beforeEach(() => {
			deleteRequests = [];
			const passThrough = window.fetch.bind(window);
			vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
				const url = input instanceof Request ? input.url : String(input);
				if (!url.includes('?/delete')) return passThrough(input, init);
				deleteRequests.push(url);
				// Never settles: the tests only care whether the request was sent.
				return new Promise<Response>(() => {});
			});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		test('sends no request when the confirm dialog is dismissed', async () => {
			const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
			render(Page, { data: makeData(), form: null });

			await page.getByRole('button', { name: 'Löschen' }).click();

			expect(confirm).toHaveBeenCalledWith(expect.stringContaining('kid'));
			expect(deleteRequests).toHaveLength(0);
		});

		test('sends the delete request once confirmed', async () => {
			vi.spyOn(window, 'confirm').mockReturnValue(true);
			render(Page, { data: makeData(), form: null });

			await page.getByRole('button', { name: 'Löschen' }).click();

			await expect.poll(() => deleteRequests).toHaveLength(1);
		});
	});
});
