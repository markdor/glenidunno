import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createRawSnippet } from 'svelte';
import type { ResolvedPathname } from '$app/types';
import SubHeader from './SubHeader.svelte';

const backHref = '/admin/tastings' as ResolvedPathname;

describe('SubHeader', () => {
	test('renders the back link and the page title', async () => {
		render(SubHeader, { backHref, backLabel: 'Alle Tastings', title: 'Herbst-Tasting' });

		await expect
			.element(page.getByRole('link', { name: 'Alle Tastings' }))
			.toHaveAttribute('href', '/admin/tastings');
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Herbst-Tasting' }))
			.toBeVisible();
	});

	test('renders an optional action next to the title', async () => {
		const action = createRawSnippet(() => ({ render: () => '<button>Aktion</button>' }));
		render(SubHeader, { backHref, backLabel: 'Zurück', title: 'Titel', action });

		await expect.element(page.getByRole('button', { name: 'Aktion' })).toBeVisible();
	});
});
