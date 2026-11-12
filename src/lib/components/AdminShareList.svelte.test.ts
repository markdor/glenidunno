import { describe, test, expect, afterEach, vi, type MockInstance } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { AdminShare } from '$lib/tasting';
import AdminShareList from './AdminShareList.svelte';
import { confirmDialog } from './confirmDialogStore.svelte';

const TOKEN = 'a'.repeat(43);

const share: AdminShare = {
	token: TOKEN,
	bottle: 'Caol Ila 12 Jahre Sherry Cask (Signatory)',
	alias: 'Nebel',
	tastingName: 'Inselhüpfen',
	tastingDate: '2026-10-24',
	owner: 'Anna',
	createdAt: new Date('2026-10-26T10:00:00Z')
};

afterEach(() => {
	if (confirmDialog.request) confirmDialog.cancel();
});

describe('AdminShareList', () => {
	test('lists every link with bottle, alias, tasting, bringer and date', async () => {
		render(AdminShareList, { shares: [share] });
		await expect.element(page.getByRole('heading', { name: 'Geteilte Links (1)' })).toBeVisible();
		const item = page.getByRole('listitem');
		await expect.element(item).toHaveTextContent(share.bottle);
		await expect.element(item).toHaveTextContent('„Nebel" · Inselhüpfen · Sa., 24.10.2026');
		await expect.element(item).toHaveTextContent('von Anna, geteilt am 26.10.2026');
		await expect
			.element(page.getByRole('link', { name: 'Link zu Nebel öffnen' }))
			.toHaveAttribute('href', `/share/${TOKEN}`);
	});

	test('says so without links', async () => {
		render(AdminShareList, { shares: [] });
		await expect.element(page.getByText('Keine geteilten Links.')).toBeVisible();
		expect(page.getByRole('listitem').elements()).toHaveLength(0);
	});

	test('asks before revoking and submits the token only when confirmed', async () => {
		const requestSubmit: MockInstance<HTMLFormElement['requestSubmit']> = vi
			.spyOn(HTMLFormElement.prototype, 'requestSubmit')
			.mockImplementation(() => {});
		try {
			render(AdminShareList, { shares: [share] });
			await page.getByRole('button', { name: 'Link zu Nebel widerrufen' }).click();
			expect(confirmDialog.request).toMatchObject({
				message: expect.stringContaining('von Anna widerrufen'),
				variant: 'danger',
				confirmLabel: 'Widerrufen'
			});
			confirmDialog.confirm();
			await expect.poll(() => requestSubmit.mock.calls.length).toBe(1);
			const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
			expect(form.getAttribute('action')).toBe('?/revokeShare');
			expect(new FormData(form).get('token')).toBe(TOKEN);
		} finally {
			requestSubmit.mockRestore();
		}
	});
});
