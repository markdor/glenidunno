import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ResolvedPathname } from '$app/types';
import TastingOrderList from './TastingOrderList.svelte';

const presentationHref = (bottleId: string) =>
	`/tasting/${'t'.repeat(32)}/presentation/${bottleId}` as ResolvedPathname;

describe('TastingOrderList', () => {
	test('lists the aliases in pouring order', async () => {
		render(TastingOrderList, {
			order: [
				{ position: 1, alias: 'Blume', score: 35.2, presentation: null },
				{ position: 2, alias: 'Nebel', score: 75.2, presentation: null }
			],
			presentationHref
		});

		const items = page.getByRole('listitem');
		expect(items.elements()).toHaveLength(2);
		await expect.element(items.nth(0)).toHaveTextContent(/1.*Blume/);
		await expect.element(items.nth(1)).toHaveTextContent(/2.*Nebel/);
	});

	test('links a presentation for download, without its file name', async () => {
		render(TastingOrderList, {
			order: [
				{ position: 1, alias: 'Blume', score: 35.2, presentation: null },
				{ position: 2, alias: 'Nebel', score: 75.2, presentation: { bottleId: 'b2' } }
			],
			presentationHref
		});

		const link = page.getByRole('link', { name: 'Präsentation zu Nebel' });
		await expect.element(link).toHaveAttribute('href', presentationHref('b2'));
		await expect.element(link).toHaveAttribute('download');
		expect(page.getByRole('link').elements()).toHaveLength(1);
	});

	test('says so when nobody entered a bottle', async () => {
		render(TastingOrderList, { order: [], presentationHref });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});
});
