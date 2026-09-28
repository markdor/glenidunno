import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingOrderList from './TastingOrderList.svelte';

describe('TastingOrderList', () => {
	test('lists the aliases in pouring order', async () => {
		render(TastingOrderList, {
			order: [
				{ position: 1, alias: 'Blume' },
				{ position: 2, alias: 'Nebel' }
			]
		});

		const items = page.getByRole('listitem');
		expect(items.elements()).toHaveLength(2);
		await expect.element(items.nth(0)).toHaveTextContent(/1.*Blume/);
		await expect.element(items.nth(1)).toHaveTextContent(/2.*Nebel/);
	});

	test('says so when nobody entered a bottle', async () => {
		render(TastingOrderList, { order: [] });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});
});
