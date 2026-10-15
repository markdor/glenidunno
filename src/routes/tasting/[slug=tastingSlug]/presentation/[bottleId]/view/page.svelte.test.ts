import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// The page builds its links from the slug and bottle id of its own URL.
vi.mock('$app/state', () => ({ page: { params: { slug: 'fluffy-otter', bottleId: 'b1' } } }));

import Page from './+page.svelte';

function show(back: 'tasting' | 'history') {
	return render(Page, { data: { user: null, back } } as never);
}

// Never answered: the viewer stays in its loading state.
beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise<Response>(() => {}))
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('presentation viewer page', () => {
	test('keeps the page title neutral and names no file', async () => {
		show('tasting');
		await expect.poll(() => document.title).toBe('Whisky-Tasting');
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Präsentation', exact: true }))
			.toBeVisible();
	});

	test('leads back to the participant page and offers the download', async () => {
		show('tasting');
		await expect
			.element(page.getByRole('link', { name: 'Tasting', exact: true }))
			.toHaveAttribute('href', '/tasting/fluffy-otter');
		const download = page.getByRole('link', { name: 'Herunterladen' });
		await expect.element(download).toHaveAttribute('href', '/tasting/fluffy-otter/presentation/b1');
		await expect.element(download).toHaveAttribute('download');
	});

	test('leads back to the history it came from', async () => {
		show('history');
		await expect
			.element(page.getByRole('link', { name: 'Historie', exact: true }))
			.toHaveAttribute('href', '/history');
	});

	test('fetches the PDF through the tasting link after the mount', async () => {
		show('tasting');
		await expect.element(page.getByText('Präsentation wird vorbereitet …')).toBeVisible();
		await expect
			.poll(() => vi.mocked(fetch).mock.calls[0]?.[0])
			.toBe('/tasting/fluffy-otter/presentation/b1/pdf');
	});
});
