import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ResolvedPathname } from '$app/types';
import TastingOrderList from './TastingOrderList.svelte';

const presentationHref = (bottleId: string) =>
	`/tasting/${'t'.repeat(32)}/presentation/${bottleId}` as ResolvedPathname;
const viewHref = (bottleId: string) =>
	`/tasting/${'t'.repeat(32)}/presentation/${bottleId}/view` as ResolvedPathname;

describe('TastingOrderList', () => {
	test('lists the aliases in pouring order', async () => {
		render(TastingOrderList, {
			order: [
				{ position: 1, alias: 'Blume', score: 35.2, presentation: null },
				{ position: 2, alias: 'Nebel', score: 75.2, presentation: null }
			],
			presentationHref,
			viewHref
		});

		const items = page.getByRole('listitem');
		expect(items.elements()).toHaveLength(2);
		await expect.element(items.nth(0)).toHaveTextContent(/1.*Blume/);
		await expect.element(items.nth(1)).toHaveTextContent(/2.*Nebel/);
	});

	test('links a presentation for download and the viewer, without its file name', async () => {
		render(TastingOrderList, {
			order: [
				{ position: 1, alias: 'Blume', score: 35.2, presentation: null },
				{
					position: 2,
					alias: 'Nebel',
					score: 75.2,
					presentation: { bottleId: 'b2', viewable: true }
				}
			],
			presentationHref,
			viewHref
		});

		const download = page.getByRole('link', { name: 'Präsentation zu Nebel', exact: true });
		await expect.element(download).toHaveAttribute('href', presentationHref('b2'));
		await expect.element(download).toHaveAttribute('download');
		const view = page.getByRole('link', { name: 'Präsentation zu Nebel ansehen' });
		await expect.element(view).toHaveAttribute('href', viewHref('b2'));
		await expect.element(view).not.toHaveAttribute('download');
		expect(page.getByRole('link').elements()).toHaveLength(2);
	});

	test('offers only the download for a format the viewer can not show', async () => {
		render(TastingOrderList, {
			order: [
				{
					position: 1,
					alias: 'Nebel',
					score: 75.2,
					presentation: { bottleId: 'b1', viewable: false }
				}
			],
			presentationHref,
			viewHref
		});

		await expect
			.element(page.getByRole('link', { name: 'Präsentation zu Nebel', exact: true }))
			.toBeVisible();
		expect(
			page.getByRole('link', { name: 'Präsentation zu Nebel ansehen' }).elements()
		).toHaveLength(0);
	});

	test('says so when nobody entered a bottle', async () => {
		render(TastingOrderList, { order: [], presentationHref, viewHref });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});
});
