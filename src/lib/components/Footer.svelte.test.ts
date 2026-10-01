import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Footer from './Footer.svelte';

describe('Footer', () => {
	test('shows the app version', async () => {
		render(Footer);

		// __APP_VERSION__ is injected by Vite at build time (vite.config.ts).
		await expect.element(page.getByText(`v${__APP_VERSION__}`)).toBeVisible();
	});

	test('links the version to the GitHub release notes', async () => {
		render(Footer);

		const link = page.getByRole('link', { name: `v${__APP_VERSION__}` });
		await expect.element(link).toBeVisible();
		await expect
			.element(link)
			.toHaveAttribute(
				'href',
				`https://github.com/markdor/glenidunno/releases/tag/v${__APP_VERSION__}`
			);
		await expect.element(link).toHaveAttribute('target', '_blank');
		await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
	});

	test('shows the "made with love and whisky" note', async () => {
		render(Footer);

		await expect.element(page.getByText(/made with/)).toBeVisible();
		await expect.element(page.getByRole('img', { name: 'love' })).toBeVisible();
		const glass = page.getByRole('img', { name: 'whisky' });
		await expect.element(glass).toBeVisible();
		// Vite inlines assets under 4 KB as data URLs, larger ones get a hashed file name.
		expect(glass.element().getAttribute('src')).toMatch(/^data:image\/svg\+xml|glencairn-glass/);
	});
});
