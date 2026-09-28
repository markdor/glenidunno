import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingLinkList from './TastingLinkList.svelte';
import { toast } from './toastStore.svelte';

const links = [
	{ name: 'Anna', url: 'https://glenidunno.test/tasting/' + 'a'.repeat(32) },
	{ name: 'Ben', url: 'https://glenidunno.test/tasting/' + 'b'.repeat(32) }
];

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('TastingLinkList', () => {
	test('shows every link as plain text, not as a clickable link', async () => {
		render(TastingLinkList, { links });

		await expect.element(page.getByText(links[0].url)).toBeVisible();
		await expect.element(page.getByText(links[1].url)).toBeVisible();
		expect(page.getByRole('link').elements()).toHaveLength(0);
		await expect
			.element(page.getByText(/Die Links werden nur jetzt angezeigt/))
			.toHaveTextContent(/nicht in die Gruppe/);
	});

	test('copies a link and confirms it with a toast', async () => {
		const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
		render(TastingLinkList, { links });

		await page.getByRole('button', { name: 'Link für Ben kopieren' }).click();

		expect(writeText).toHaveBeenCalledWith(links[1].url);
		await expect
			.poll(() => toast.toasts.map((t) => [t.variant, t.message]))
			.toContainEqual(['success', 'Link für Ben kopiert.']);
	});

	test('reports a failed copy', async () => {
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
		render(TastingLinkList, { links });

		await page.getByRole('button', { name: 'Link für Anna kopieren' }).click();

		await expect
			.poll(() => toast.toasts.some((t) => t.variant === 'error' && /Kopieren/.test(t.message)))
			.toBe(true);
	});
});
