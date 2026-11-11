import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const TOKEN = 'a'.repeat(43);
// The page builds the PDF link from the token of its own URL.
vi.mock('$app/state', () => ({ page: { params: { token: 'a'.repeat(43) } } }));

import { SCORE_RULES, type SharedBottleView } from '$lib/tasting';
import Page from './+page.svelte';

// Never answered: the viewer stays in its loading state.
const fetchPdf = vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));
beforeEach(() => {
	fetchPdf.mockClear();
	vi.stubGlobal('fetch', fetchPdf);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const view: SharedBottleView = {
	tasting: { name: 'Inselhüpfen', subtitle: 'Tasting #3', tastingDate: '2026-10-24' },
	presentation: true,
	archived: false,
	algorithm: 'taste',
	position: 1,
	total: 2,
	rules: SCORE_RULES,
	bottle: {
		alias: 'Nebel',
		distillery: 'Ardbeg',
		bottler: null,
		bottling: 'Uigeadail',
		age: null,
		abv: 54.2,
		whiskybaseUrl: null,
		smoke: 5,
		cask: 3,
		value: 4,
		score: 78.6,
		shares: { smoke: 1, cask: 0.6, abv: 0.48, value: 0.8 }
	}
};

const pdfHref = `/share/${TOKEN}/pdf`;

describe('/share/[token]', () => {
	test('shows the bottle, its tasting, the explainer tile and the presentation', async () => {
		render(Page, { data: { user: null, view } });

		await expect.element(page.getByRole('heading', { level: 1, name: 'Nebel' })).toBeVisible();
		await expect.element(page.getByText('Ardbeg Uigeadail', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Tasting „Inselhüpfen“ · Tasting #3')).toBeVisible();
		await expect.element(page.getByText('Sa., 24.10.2026')).toBeVisible();
		await expect.element(page.getByRole('article', { name: 'Whisky' })).toBeVisible();
		await expect.element(page.getByRole('heading', { name: 'Präsentation' })).toBeVisible();
		const download = page.getByRole('link', { name: 'PDF herunterladen' });
		await expect.element(download).toHaveAttribute('href', pdfHref);
		await expect.element(download).toHaveAttribute('download');
		// The viewer fetches the shared PDF after its mount.
		await expect.poll(() => fetchPdf.mock.calls.map((call) => String(call[0]))).toContain(pdfHref);
		// The explainer tile of the frozen rules.
		expect(document.body.textContent).toContain('Rauch');
	});

	test('shows the brand without a login, not next to the app header', async () => {
		const anonymous = render(Page, { data: { user: null, view } });
		await expect.element(page.getByText('Glen Idunno', { exact: true })).toBeVisible();
		anonymous.unmount();

		render(Page, { data: { user: { id: 'u', username: 'Anna', isAdmin: false }, view } });
		await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();
		expect(page.getByText('Glen Idunno', { exact: true }).elements()).toHaveLength(0);
	});

	test('keeps title and previews neutral and the page out of search engines', async () => {
		render(Page, { data: { user: null, view } });
		await expect.poll(() => document.title).toBe('Whisky bei Glen Idunno');
		expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
			'noindex'
		);
	});

	test('leaves out the presentation and, for an archived bottle, the explainer tile', async () => {
		render(Page, {
			data: {
				user: null,
				view: {
					tasting: { ...view.tasting, subtitle: null },
					presentation: false,
					archived: true,
					bottle: { ...view.bottle }
				}
			}
		});
		await expect.element(page.getByText('Tasting „Inselhüpfen“', { exact: true })).toBeVisible();
		expect(page.getByRole('heading', { name: 'Präsentation' }).elements()).toHaveLength(0);
		expect(fetchPdf).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain('Score');
	});
});
