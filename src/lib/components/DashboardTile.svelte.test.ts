import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { resolve } from '$app/paths';
import { ChartColumn, Plus } from '@lucide/svelte';
import DashboardTile from './DashboardTile.svelte';

describe('DashboardTile', () => {
	test('links an existing section', async () => {
		render(DashboardTile, {
			title: 'Neues Tasting',
			icon: Plus,
			href: resolve('/admin/tastings/new')
		});

		const tile = page.getByRole('link', { name: 'Neues Tasting' });
		await expect.element(tile).toHaveAttribute('href', '/admin/tastings/new');
		expect(page.getByText('Demnächst').elements()).toHaveLength(0);
	});

	test('shows a section still to come as neither link nor focus target', async () => {
		const { container } = render(DashboardTile, { title: 'Statistiken', icon: ChartColumn });

		await expect.element(page.getByText('Statistiken')).toBeVisible();
		await expect.element(page.getByText('Demnächst')).toBeVisible();
		expect(page.getByRole('link').elements()).toHaveLength(0);
		expect(container.querySelector('a, button, [tabindex]')).toBeNull();

		const tile = container.firstElementChild as HTMLElement;
		tile.focus();
		expect(document.activeElement).not.toBe(tile);
	});
});
